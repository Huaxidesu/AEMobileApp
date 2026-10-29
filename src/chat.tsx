// 聊天状态：全局常驻订阅 + 本地 7 天缓存。
//
// 生命周期挂在 AppShell 上（不是聊天页）：只要账号配好了就一直订阅，
// 所以切到别的 Tab 也能收消息、底栏能显示未读角标。
// 断线重连由 net/conn.ts 统一处理，重连后会用 stream.params 里的 since/boot 续传。
//
// 服务端**不存历史**：它只有 30 秒 / 128 条的投递缓冲，断线久了会丢（帧里带 gap）。
// 历史在这边落盘，见 chatlog.ts。
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isConfigComplete, openStream, sendChat } from './api';
import type { ChatFrame, ServerConfig } from './api';
import { useConfig } from './config';
import { getActiveAccount, getActiveAccountId, setChatName as persistChatName } from './accounts';
import { appendAll, clearScope, loadRecent } from './chatlog';
import type { StoredMsg } from './chatlog';
import { serverKey } from './cache';

/** 内存里最多留这么多条（再多也没人往下翻，SQLite 里还有完整的 7 天） */
const MAX_IN_MEMORY = 600;
const MAX_NAME = 16;

export type ChatStatus = 'idle' | 'connecting' | 'online' | 'error';

export type ChatMessage = StoredMsg;

interface ChatCtx {
  msgs: ChatMessage[];
  /** 未读数（只在聊天页没打开时累加） */
  unread: number;
  status: ChatStatus;
  error: string;
  /** 服务端重启/断线太久，中间丢了一段 */
  gap: boolean;
  /** 自定义昵称；空字符串表示还没设置（首次进聊天页要强制填） */
  name: string;
  setName: (n: string) => void;
  /** 聊天页聚焦/失焦，用来算未读 */
  setActive: (v: boolean) => void;
  send: (text: string) => Promise<void>;
  clear: () => void;
}

const Ctx = createContext<ChatCtx>(null as any);

function keyOf(m: { boot: number; seq: number }): string {
  return `${m.boot}:${m.seq}`;
}

/** 合并并按时间排序，截到 MAX_IN_MEMORY */
function merge(prev: ChatMessage[], add: ChatMessage[]): ChatMessage[] {
  const out = prev.concat(add).sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  return out.length > MAX_IN_MEMORY ? out.slice(out.length - MAX_IN_MEMORY) : out;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { config, ready } = useConfig();

  /** 换服务器/换密码就是另一套聊天，缓存和游标都要重置 */
  const scope = useMemo(() => serverKey(config), [config.ip, config.port, config.token]);
  const connKey = `${config.ip}|${config.port}|${config.token}`;

  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState('');
  const [gap, setGap] = useState(false);
  const [name, setNameState] = useState('');

  /** 已入册的消息键，重连补发时用来去重 */
  const seen = useRef<Set<string>>(new Set());
  const activeRef = useRef(false);
  const nameRef = useRef('');
  /** 下次订阅要带的游标 */
  const cursor = useRef({ since: 0, boot: 0 });

  nameRef.current = name;

  // 昵称跟账号走：切账号时重新读
  useEffect(() => {
    try {
      setNameState(getActiveAccount().chatName ?? '');
    } catch {
      setNameState('');
    }
  }, [scope]);

  // 订阅 + 载入历史
  useEffect(() => {
    setUnread(0);
    setGap(false);
    setError('');

    if (!ready || !isConfigComplete(config)) {
      setStatus('idle');
      setMsgs([]);
      seen.current = new Set();
      cursor.current = { since: 0, boot: 0 };
      return;
    }

    // 先出历史（7 天内），再订阅增量；两边靠 (boot, seq) 去重
    const rows = loadRecent(scope);
    seen.current = new Set(rows.map(keyOf));
    setMsgs(rows);
    const last = rows.length ? rows[rows.length - 1] : null;
    cursor.current = last ? { since: last.seq, boot: last.boot } : { since: 0, boot: 0 };

    setStatus('connecting');
    const stream = openStream(config as ServerConfig, 'chat', {
      since: cursor.current.since,
      boot: cursor.current.boot,
    });

    stream.addEventListener('open', () => {
      setStatus('online');
      setError('');
    });

    stream.addEventListener('message', (ev: any) => {
      const f = ev?.data as ChatFrame;
      if (!f || f.t !== 'c' || !Array.isArray(f.m)) return;

      const incoming: ChatMessage[] = [];
      for (const row of f.m) {
        if (!Array.isArray(row) || row.length < 5) continue;
        const [seq, kind, who, text, ts] = row;
        const item: ChatMessage = { scope, boot: f.boot, seq, ts, kind, name: String(who), text: String(text) };
        const k = keyOf(item);
        if (seen.current.has(k)) continue;
        seen.current.add(k);
        incoming.push(item);
      }

      if (f.gap) setGap(true);
      cursor.current = { since: f.seq, boot: f.boot };
      // 重连时 conn.ts 会用 stream.params 重新订阅 —— 把游标写回去就是「续传」
      stream.params.since = f.seq;
      stream.params.boot = f.boot;

      if (incoming.length === 0) return;
      appendAll(incoming);
      setMsgs((prev) => merge(prev, incoming));
      if (!activeRef.current) {
        const fresh = incoming.filter((m) => !(m.kind === 1 && m.name === nameRef.current)).length;
        if (fresh > 0) setUnread((u) => u + fresh);
      }
    });

    stream.addEventListener('error', (ev: any) => {
      setStatus('error');
      setError(String(ev?.message ?? '连接已断开'));
    });

    return () => stream.close();
  }, [scope, connKey, ready]);

  const setName = useCallback((next: string) => {
    const v = next.trim().slice(0, MAX_NAME);
    setNameState(v);
    try {
      persistChatName(getActiveAccountId(), v);
    } catch (e) {
      console.warn('[chat] save name failed', e);
    }
  }, []);

  const setActive = useCallback((v: boolean) => {
    activeRef.current = v;
    if (v) setUnread(0);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      if (!name.trim()) throw new Error('请先设置聊天昵称');
      const res = await sendChat(config as ServerConfig, name.trim(), t);
      if (!res.succeed) throw new Error(res.message || '发送失败');
    },
    [config, name],
  );

  const clear = useCallback(() => {
    clearScope(scope);
    setMsgs([]);
    setUnread(0);
    seen.current = new Set();
    setGap(false);
  }, [scope]);

  const value = useMemo<ChatCtx>(
    () => ({ msgs, unread, status, error, gap, name, setName, setActive, send, clear }),
    [msgs, unread, status, error, gap, name, setName, setActive, send, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat(): ChatCtx {
  return useContext(Ctx);
}
