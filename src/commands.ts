// 聊天输入框的「斜杠命令」与「@ 提及」数据表。
//
// 设计：输入框是唯一入口。
//   - 输入 `/`   → 弹模块列表（目前只有「点歌」）；
//   - 输入 `@`   → 弹候选（在线玩家 / AllMusic）；
//   - 选 AllMusic → 插入 `@allmusic ` 并弹命令面板；
//   - 发送时 `@allmusic ...` 和 `/music ...` 都**不进公屏**，转成 music 请求
//     走 AEMobileBridge（和音乐面板同一条链路）。
//
// 命令清单复制自服务器上 `/music help` 的输出（`[肥猫电台]` 前缀已去掉），
// 分「常用」和「更多」两组，避免一屏全是 hud 参数。
import type { ServerConfig } from './api';

export type Outgoing =
  | { kind: 'chat'; text: string }
  | { kind: 'music'; cmd: string; args: string[] }
  | { kind: 'unknown'; raw: string };

export interface MusicCmd {
  /** 显示用（不带 /music 前缀） */
  label: string;
  /** 发给服务端的子命令 */
  cmd: string;
  /** 固定参数（`vote cancel` 这种拆成 cmd=vote, fixed=[cancel]） */
  fixed?: string[];
  /** 需要用户补参数时的占位符；有占位就不直接执行，而是插进输入框 */
  argHint?: string;
  desc: string;
  group: 'basic' | 'more';
}

export const MUSIC_COMMANDS: MusicCmd[] = [
  { label: 'search', cmd: 'search', argHint: '[歌名]', desc: '搜索歌曲', group: 'basic' },
  { label: 'select', cmd: 'select', argHint: '[序号]', desc: '选择搜索结果里的第几首', group: 'basic' },
  { label: 'list', cmd: 'list', desc: '查看歌曲队列', group: 'basic' },
  { label: 'vote', cmd: 'vote', desc: '发起投票切歌', group: 'basic' },
  { label: 'push', cmd: 'push', argHint: '[序号]', desc: '投票把歌曲插到队头', group: 'basic' },
  { label: 'cancel', cmd: 'cancel', argHint: '[序号]', desc: '取消自己的点歌', group: 'basic' },
  { label: 'next', cmd: 'next', desc: '强制切歌（需要权限）', group: 'basic' },
  { label: 'stop', cmd: 'stop', desc: '停止播放', group: 'basic' },
  { label: 'mute', cmd: 'mute', desc: '不再参与点歌', group: 'basic' },

  { label: 'nextpage', cmd: 'nextpage', desc: '搜索结果下一页', group: 'more' },
  { label: 'lastpage', cmd: 'lastpage', desc: '搜索结果上一页', group: 'more' },
  { label: 'vote cancel', cmd: 'vote', fixed: ['cancel'], desc: '取消发起的切歌投票', group: 'more' },
  { label: 'push cancel', cmd: 'push', fixed: ['cancel'], desc: '取消发起的插歌投票', group: 'more' },
  { label: 'mute list', cmd: 'mute', fixed: ['list'], desc: '不再接收空闲列表点歌', group: 'more' },
  { label: 'ban', cmd: 'ban', argHint: '[ID]', desc: '禁止点这首歌', group: 'more' },
  { label: 'banplayer', cmd: 'banplayer', argHint: '[玩家]', desc: '禁止某玩家点歌', group: 'more' },
  { label: 'hud enable', cmd: 'hud', fixed: ['enable'], desc: '开关全部 HUD 界面', group: 'more' },
  { label: 'hud reset', cmd: 'hud', fixed: ['reset'], desc: '重置全部 HUD 界面', group: 'more' },
  { label: 'hud pic size', cmd: 'hud', fixed: ['pic', 'size'], argHint: '[尺寸]', desc: '设置 HUD 图片尺寸', group: 'more' },
  { label: 'reload', cmd: 'reload', desc: '重读 AllMusic 配置', group: 'more' },
];

/** `/` 弹出的模块列表。以后新增模块（比如查 TPS）在此处添加一行即可 */
export interface ChatModule {
  id: string;
  label: string;
  icon: 'musical-notes';
  desc: string;
  /** 选中后插进输入框的前缀 */
  prefix: string;
}

export const CHAT_MODULES: ChatModule[] = [
  { id: 'music', label: '点歌', icon: 'musical-notes', desc: '搜索 / 点歌 / 队列 / 投票', prefix: '@allmusic ' },
];

/** AllMusic 在 @ 候选里的名字（也是聊天里的提及文本） */
export const ALLMUSIC_NAME = 'allmusic';

const ALLMUSIC_PREFIX = /^@allmusic(?:\s+|$)/i;
const MUSIC_PREFIX = /^\/music(?:\s+|$)/i;

/**
 * 解析用户要发出去的内容。
 *
 * - `@allmusic /music search 晴天` / `@allmusic search 晴天` / `/music search 晴天`
 *   → `{ kind:'music', cmd:'search', args:['晴天'] }`
 * - 其它 `/xxx` → `unknown`（App 发不了游戏命令，直接提示，别当聊天刷公屏）
 * - 其余 → 普通聊天
 */
export function parseOutgoing(raw: string): Outgoing | null {
  const text = raw.trim();
  if (!text) return null;

  let body = text;
  let isMusic = false;

  const m = body.match(ALLMUSIC_PREFIX);
  if (m) {
    body = body.slice(m[0].length).trim();
    isMusic = true;
  }
  const mm = body.match(MUSIC_PREFIX);
  if (mm) {
    body = body.slice(mm[0].length).trim();
    isMusic = true;
  }

  if (isMusic) {
    if (!body) return { kind: 'music', cmd: '', args: [] }; // 只发了 @allmusic → 等价于 help
    const parts = body.split(/\s+/);
    const cmd = (parts.shift() ?? '').toLowerCase();
    return { kind: 'music', cmd, args: parts };
  }

  if (text.startsWith('/')) return { kind: 'unknown', raw: text };
  return { kind: 'chat', text };
}

/** 命令 → 插进输入框的文本（点面板里的命令时用） */
export function commandText(c: MusicCmd, withArgs = true): string {
  const fixed = c.fixed?.length ? ` ${c.fixed.join(' ')}` : '';
  const tail = withArgs && c.argHint ? ` ${c.argHint} ` : '';
  return `@allmusic /music ${c.cmd}${fixed}${tail}`;
}

/** 命令 → 直接执行的参数 */
export function commandArgs(c: MusicCmd): { cmd: string; args: string[] } {
  return { cmd: c.cmd, args: c.fixed ? [...c.fixed] : [] };
}

/** 按输入里的关键字过滤命令（`@allmusic sea` → 只剩 search） */
export function filterCommands(query: string): MusicCmd[] {
  const q = query.trim().toLowerCase();
  if (!q) return MUSIC_COMMANDS;
  return MUSIC_COMMANDS.filter(
    (c) => c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q) || c.cmd.toLowerCase().startsWith(q),
  );
}

/** 输入框里最后一个 `@xxx` 片段（没写完也算），用于弹候选 */
export function trailingMention(draft: string): { start: number; word: string } | null {
  const m = /@([A-Za-z0-9_\u4e00-\u9fa5]*)$/.exec(draft);
  if (!m) return null;
  return { start: m.index, word: m[1] };
}

/** 输入框是不是在「命令模式」：`/` 开头，或 `@allmusic` 后面还有内容 */
export function commandQuery(draft: string): string | null {
  const t = draft.trimStart();
  if (t.startsWith('/')) return t.slice(1);
  const m = /^@allmusic\s+\/?\s*(?:music\s+)?(.*)$/i.exec(t);
  if (m) return m[1];
  return null;
}

/** 在线玩家 + 最近用过的 App 昵称（去重，最多 20 个） */
export function mergeCandidates(mc: string[], app: string[], limit = 20): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of [...mc, ...app]) {
    const k = n.toLowerCase();
    if (!n || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

/** 服务端未配置时也不应崩溃：`players` op 属于附加功能 */
export function canAskPlayers(cfg: ServerConfig): boolean {
  return !!(cfg.ip && cfg.token);
}
