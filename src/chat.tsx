// 聊天状态：全局常驻订阅 + 本地 7 天缓存。
//
// 生命周期挂在 AppShell 上（不是聊天页）：只要账号配好了就一直订阅，
// 所以切到其他 Tab 也能收消息、底栏能显示未读角标。
// 断线重连由 net/conn.ts 统一处理，重连后会用 stream.params 里的 since/boot 续传。
//
// 服务端**不存历史**：它只有 30 秒 / 128 条的投递缓冲，断线过久会丢失（帧里带 gap）。
// 历史在这边落盘，见 chatlog.ts。
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isConfigComplete, openStream, sendChat } from './api';
import type { ChatFrame, ServerConfig } from './api';
import { useConfig } from './config';
import { getActiveAccount, getActiveAccountId, setChatName as persistChatName } from './accounts';
import { appendAll, clearScope, loadRecent } from './chatlog';
import type { StoredMsg } from './chatlog';
import { serverKey } from './cache';
import { warmup } from './zhdict';

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
  /** 服务端重启/断线太久，中间丢失了一段 */
  gap: boolean;
  /** 自定义昵称；空字符串表示还没设置（首次进聊天页要强制填） */
  name: string;
  setName: (n: string) => void;
  /** 聊天页聚焦/失焦，用来算未读 */
  setActive: (v: boolean) => void;
  send: (text: string) => Promise<void>;
  /** 本地插一条系统行（点歌结果这类「只在这台手机上」的消息），不占未读 */
  appendLocal: (text: string) => void;
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

/** 与服务端 `ChatHub.sanitize` 对齐：去方括号/格式码/控制符，按码点截到 16 */
function cleanName(raw: string): string {
  const stripped = raw
    .replace(/§./g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\[\]]/g, '');
  return Array.from(stripped).slice(0, MAX_NAME).join('').replace(/\s+/g, ' ').trim();
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
  const myNameRef = useRef('');
  /** 下次订阅要带的游标 */
  const cursor = useRef({ since: 0, boot: 0 });

  myNameRef.current = name;

  // 中文名字典约 2.4 万条，解析一次要几十毫秒；推迟到首屏渲染完再做
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        warmup();
      } catch (e) {
        console.warn('[chat] zhdict warmup failed', e);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  // 昵称跟账号走：切账号时重新读
  useEffect(() => {
    try {
      setNameState(cleanName(getActiveAccount().chatName ?? ''));
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
      // 新 App 才收玩家进出事件；旧服务端会忽略这个参数
      events: true,
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
        // 6-10 位是 3.4.0 之后陆续加的扩展：来源服务器、结构化附件、队伍名、队伍颜色、世界名。
        // 旧服务端不发，读出来就是 undefined
        const [seq, kind, who, text, ts, srv, att, team, teamColor, world] = row;
        const item: ChatMessage = {
          scope,
          boot: f.boot,
          seq,
          ts,
          kind,
          name: String(who),
          text: String(text),
          srv: srv ? String(srv) : '',
          att: att ? String(att) : '',
          team: team ? String(team) : '',
          teamColor: teamColor ? String(teamColor) : '',
          world: world ? String(world) : '',
        };
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
        // 玩家聊天 / 服务器公告 / AllMusic 都算未读；进出提示（2/3）和自己的 App 消息不算
        const fresh = incoming.filter(
          (m) =>
            m.kind === 0 ||
            m.kind === 4 ||
            m.kind === 5 ||
            m.kind === 6 ||
            (m.kind === 1 && m.name !== myNameRef.current),
        ).length;
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
    const v = cleanName(next);
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

  /** 本地消息的 seq：用 boot=-1 和真实消息区分，主键不会撞 */
  const localSeq = useRef(0);
  const appendLocal = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      localSeq.current += 1;
      const item: ChatMessage = {
        scope,
        boot: -1,
        seq: localSeq.current,
        ts: Date.now(),
        kind: 7,
        name: '点歌',
        text: t,
        team: '',
      };
      appendAll([item]);
      setMsgs((prev) => merge(prev, [item]));
    },
    [scope],
  );

  const clear = useCallback(() => {
    clearScope(scope);
    setMsgs([]);
    setUnread(0);
    seen.current = new Set();
    setGap(false);
  }, [scope]);

  const value = useMemo<ChatCtx>(
    () => ({ msgs, unread, status, error, gap, name, setName, setActive, send, appendLocal, clear }),
    [msgs, unread, status, error, gap, name, setName, setActive, send, appendLocal, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat(): ChatCtx {
  return useContext(Ctx);
}
