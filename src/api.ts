// 服务端接口层：协议类型 + 请求封装。
//
// 2026-10-27 协议 3.0.0：传输从 HTTP + SSE 换成裸 TCP（阿里云按 Host 头拦 HTTP，
// 裸 TCP 不受影响；同时移除了 mod 里的 Spring/Tomcat）。
// 屏幕层只认这里的 op 名字，帧格式仍然是「全量 + 增量 + 心跳」，见 frames.ts。
//
// 契约：AEMobile/doc/传输协议与安全.md
import TcpSocket from 'react-native-tcp-socket';
import { setClockOffset } from './auth';
import { Stream, probeServer, requestOnce, tcp } from './net/conn';
import { entryForHost, loadCachedServerList } from './serverlist';

export interface AENetwork {
  dimid: number;
  x: number;
  y: number;
  z: number;
}

export interface ServerConfig {
  /** 历史字段，协议 3.0.0 起恒为 'tcp'，只为兼容旧账号记录保留 */
  scheme: string;
  ip: string;
  port: string;
  /**
   * 访问令牌（26 字符 Base32）。放置监控器时由服务端自动生成、聊天栏显示一次。
   * 不上网线，只用于本地计算 HMAC 签名。
   */
  token: string;
  mainnet: AENetwork | null;
  /**
   * 游客（仅聊天）模式：不填绑定码，服务端允许免签订阅 chat 流。
   * 为 true 时 token / mainnet 可以为空，App 也不会发任何 REQ（物品、合成、TPS 全部没有）。
   */
  guest?: boolean;
}

export interface ApiResponse<T> {
  succeed: boolean;
  body: T;
  message?: string;
}

/** mod 默认的 TCP 端口（config 里 [server] port 可改） */
export const DEFAULT_PORT = '44444';

export function isConfigComplete(cfg: ServerConfig): boolean {
  // 游客只要一个地址：免绑定码，也没有 AE 功能可看（主网自然不需要）
  if (cfg.guest) return !!cfg.ip;
  return !!(cfg.ip && cfg.token && cfg.mainnet && cfg.mainnet.x != null);
}

/** 展示用的连接串 */
export function baseUrl(cfg: ServerConfig): string {
  return cfg.ip ? `${cfg.ip}:${cfg.port}` : '';
}

// --------------------------------------------------------------- 请求

/**
 * 一次性请求。
 *
 * op 与旧 HTTP 端点的对应：
 *   networks / itemsOnce / cpusOnce / detailsOnce / start / cancel / plan / mspt
 */
export async function request<T>(
  cfg: ServerConfig,
  op: string,
  params?: Record<string, any>,
  onProgress?: (body: any) => void,
): Promise<ApiResponse<T>> {
  // 一次性请求走独立短连接：不干扰屏幕里的订阅流（设置页用的是未保存的表单配置）
  const res = await requestOnce<T>(cfg, op, params, onProgress);
  return { succeed: res.ok, body: res.b as T, message: res.m };
}

/**
 * 打开一条推送流。返回的对象是 EventSource 的形状（addEventListener / close），
 * 事件：
 *   'message' → { data: 帧对象 }，直接喂给 parseFrame
 *   'error'   → { message, code?, xhrStatus? }（401 表示密码错）
 *
 * 断线重连在 net/conn.ts 里统一处理，重连后会自动续订并带 sid，
 * 屏幕层不需要再自己写重试。
 */
export function openStream(
  cfg: ServerConfig,
  op: string,
  params?: Record<string, any>,
): Stream {
  return tcp.subscribe(cfg, op, params);
}

/**
 * 测试连接：只握手不鉴权（不需要密码），同时完成对时。
 * 返回服务器版本和本机时钟偏差（秒）。
 */
export async function testConnection(
  ip: string,
  port: string,
): Promise<{ ok: boolean; ver?: string; offset?: number }> {
  try {
    const info = await probeServer(ip, port);
    const offset = info.time > 0 ? info.time - Date.now() / 1000 : 0;
    if (Math.abs(offset) < 3600) setClockOffset(offset);
    return { ok: true, ver: info.ver, offset };
  } catch {
    return { ok: false };
  }
}

// 服务端数字格式化（1024 进制 K/M/G/T/P/E）
// 补 P/E 的原因：AE2 的 CPU 容量上限接近 Long.MAX（9.2e18），
// 只到 T 的话会输出 "8.39e+6T" 这种科学计数法，很难读。
export function formatItemCount(itemCount: number): string {
  if (!Number.isFinite(itemCount)) return '0';
  if (itemCount < 10000) return Math.round(itemCount).toString();
  if (itemCount < 1000000) return (itemCount / 1024).toPrecision(3) + 'K';
  if (itemCount < 1000000000) return (itemCount / 1048576).toPrecision(3) + 'M';
  if (itemCount < 1000000000000) return (itemCount / 1073741824).toPrecision(3) + 'G';
  if (itemCount < 1125899906842624) return (itemCount / 1099511627776).toPrecision(3) + 'T';
  if (itemCount < 1152921504606847000) return (itemCount / 1125899906842624).toPrecision(3) + 'P';
  return (itemCount / 1152921504606847000).toPrecision(3) + 'E';
}

// ---- 协议类型 ----

/** 客户端展示用的物品（由全量帧 + 增量帧拼出来） */
export interface ItemStackResp {
  item_name: string;
  meta: number;
  count: number;
  craftable: boolean;
  nbt?: string | null;
}

export interface CraftingCPUInfo {
  idx: number;
  cpuName: string;
  storage: number;
  parallelism: number;
  item: string | null;
  remainingCount: number;
  meta: number;
  nbt?: string | null;
}

export interface CraftTaskItem {
  name: string;
  meta: number;
  nbt?: string | null;
  crafting: boolean;
  numberPresent: number;
  numberSent: number;
  numberRemainingToCraft: number;
  missing: number;
  // 客户端填充
  dname?: string | null;
  icon?: string | null;
  nbtobj?: any;
  original_name?: string;
  original_meta?: number;
}

export interface CraftPlan {
  plan: CraftTaskItem[];
  bytesUsed: number;
}

// ---- TPS / MSPT（服务端 metrics/TickStats，op = "tps"，固定 5 秒一帧） ----

/** 服务端整体（最近 5 秒窗口） */
export interface TpsSrv {
  /** 每 tick 平均耗时（毫秒） */
  mspt: number;
  /** 窗口内单 tick 最差耗时（毫秒） */
  max: number;
  /** 由 mspt 折算：<=50ms 恒为 20 */
  tps: number;
  /** 窗口内 tick 数，0 表示没数据 */
  ticks: number;
  /** 全服在线人数 */
  players: number;
}

/** 世界清单（一次性请求 `tps` 返回）：名字、人数、实体、区块；带 tick 数据时也在这里 */
export interface TpsWorldMeta {
  id: number;
  /** 已汉化的显示名（MV alias > config > 内置表 > provider > 世界名） */
  d: string;
  /** 世界文件夹名，如 PERSONAL_DIM_180 */
  n: string;
  p: number;
  e: number;
  c: number;
  /** 1 = 家园世界（PERSONAL_DIM_*） */
  pm: 0 | 1;
  /** 1 = 维度已加载 */
  on: 0 | 1;
  mspt?: number;
  max?: number;
  tps?: number;
  ticks?: number;
}

/** 推送帧里只带被检测维度的 tick 数据（本服 91 个维度，带全量清单 5 秒就 6KB） */
export interface TpsWorldTick {
  id: number;
  mspt: number;
  max: number;
  tps: number;
  ticks: number;
}

/** 推送帧 */
export interface TpsFrame {
  t: 'f';
  ts: number;
  srv: TpsSrv;
  w: TpsWorldTick[];
}

/** 一次性请求的完整返回 */
export interface TpsFull {
  ts: number;
  srv: TpsSrv;
  w: TpsWorldMeta[];
}

// ---- 聊天（op = "chat" 订阅 / "chatSend" 请求） ----

/**
 * 推送帧：`m` 的每一行是 `[seq, kind, name, text, ts]`，
 * 后面可跟五个可选字段：`[..., srv, att, team, teamColor, world]`。
 *
 * - `srv`：来源服务器显示名。空串表示本服；群组服里从别的子服转发过来的消息才带值。
 * - `att`：结构化附件的 JSON 数组字符串（物品链接、任务分享），没有时是空串。
 * - `team`：玩家所在队伍名（ServerUtilities），没有时是空串。
 * - `teamColor`：队伍颜色码字符（MC 的 `d` / `b` …），没有队伍或旧服务端时是空串。
 * - `world`：玩家所在世界的显示名（GTNHChat 已换成中文别名）。服务器广播和 App 消息没有，空串。
 *
 * 旧服务端不发后面几位，旧版本 App 也只读前五位，双方保持兼容。
 */
export interface ChatFrame {
  t: 'c';
  /** 服务端这次启动的标识；变了说明服务端重启过（seq 归零） */
  boot: number;
  /** 本帧最后一条的 seq，下次订阅带回去 */
  seq: number;
  /** 1 = 中间有消息过期（服务端只留 30 秒缓冲） */
  gap?: 1;
  /** 每条：seq, kind, 名字, 正文, 时间, [来源服], [附件 JSON], [队伍名], [队伍颜色码], [世界名] */
  m: [number, number, string, string, number, string?, string?, string?, string?, string?][];
}

/**
 * 发一条聊天。走**共享长连接**（不是 requestOnce 的短连接）：
 * 聊天是高频小包，每次新建连接要 3 次往返，体验会很差。
 */
export async function sendChat(
  cfg: ServerConfig,
  name: string,
  text: string,
): Promise<ApiResponse<{ seq: number; boot: number }>> {
  const res = await tcp.request<{ seq: number; boot: number }>(cfg, 'chatSend', { name, text });
  return { succeed: res.ok, body: res.b, message: res.m };
}

/**
 * 音乐：正式账号走后端 mod 的 music op，由它转发给代理上的 AEMobileBridge 执行 /music，
 * 结果私有返回（已经去掉 AllMusic 前缀和 § 颜色码）。
 *
 * 游客连接没有绑定码，服务端对非 chatSend 的 REQ 一律回 GUEST_READONLY，music op 还要用
 * 绑定码反查玩家名。为了不改动生产服的 mod，游客改由 App **直连命令桥**：以固定的虚拟
 * 身份（不对应任何在线玩家，相当于在服务器后台终端敲命令）执行 music，公屏不显示点歌者。
 * 桥端口与密钥默认取插件的出厂值，服主改过的话由在线线路清单下发（bridgePort / bridgeSecret）。
 */
export interface MusicResult {
  ok: boolean;
  lines: string[];
  online: boolean;
  message: string;
}

/** 虚拟身份：桥用它构造离线 CommandSender，游戏里看不到是谁点的歌 */
export const GUEST_MUSIC_IDENTITY = 'Server';
const DEFAULT_BRIDGE_PORT = 44445;
const DEFAULT_BRIDGE_SECRET = 'aemobile-bridge';

interface BridgeResult {
  ok: boolean;
  lines: string[];
  online: boolean;
  error: string;
}

/** 线路清单里可选的命令桥参数；没配就用插件默认值 */
async function bridgeTarget(cfg: ServerConfig): Promise<{ port: number; secret: string }> {
  let port = DEFAULT_BRIDGE_PORT;
  let secret = DEFAULT_BRIDGE_SECRET;
  try {
    const hit = await loadCachedServerList();
    const entry = hit ? entryForHost(cfg.ip, cfg.port, hit.entries) : null;
    if (entry?.bridgePort) port = Number(entry.bridgePort) || port;
    if (entry?.bridgeSecret) secret = entry.bridgeSecret;
  } catch {
    // 读缓存失败不应影响点歌，沿用默认值
  }
  return { port, secret };
}

/** 直连命令桥：TCP 一行 JSON 请求 / 一行 JSON 响应，与插件的 exec 协议一致 */
function bridgeMusic(cfg: ServerConfig, command: string, captureMs: number): Promise<BridgeResult> {
  return new Promise<BridgeResult>((resolve, reject) => {
    let settled = false;
    let buffer = '';
    let socket: any;
    let timer: any;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // 连接可能已经断开
      }
      fn();
    };

    bridgeTarget(cfg)
      .then(({ port, secret }) => {
        if (settled) return;
        socket = TcpSocket.createConnection({ host: cfg.ip, port }, () => {
          socket.write(
            JSON.stringify({ op: 'exec', secret, player: GUEST_MUSIC_IDENTITY, command, captureMs }) + '\n',
          );
        });
        timer = setTimeout(() => done(() => reject(new Error('BRIDGE_UNAVAILABLE'))), captureMs + 10000);
        socket.on('data', (chunk: any) => {
          buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          const nl = buffer.indexOf('\n');
          if (nl < 0) return;
          const line = buffer.slice(0, nl).trim();
          try {
            const r = JSON.parse(line);
            done(() =>
              resolve({
                ok: !!r.ok,
                lines: Array.isArray(r.lines) ? r.lines.map((v: unknown) => String(v)) : [],
                online: !!r.online,
                error: String(r.error ?? ''),
              }),
            );
          } catch {
            done(() => reject(new Error('MUSIC_BAD_RESPONSE')));
          }
        });
        socket.on('error', () => done(() => reject(new Error('BRIDGE_UNAVAILABLE'))));
        socket.on('close', () => done(() => reject(new Error('BRIDGE_UNAVAILABLE'))));
      })
      .catch(() => done(() => reject(new Error('BRIDGE_UNAVAILABLE'))));
  });
}

export async function sendMusic(
  cfg: ServerConfig,
  cmd: string,
  args: string[] = [],
): Promise<MusicResult> {
  // 支持游客身份服务端会直接按游客连接采用服务器身份；旧服务端忽略 player 字段
  const params: Record<string, any> = { cmd, args };
  if (cfg.guest) params.player = GUEST_MUSIC_IDENTITY;
  const res = await tcp.request<{ lines?: string[]; online?: boolean }>(cfg, 'music', params);
  if (res.ok) {
    return {
      ok: true,
      lines: Array.isArray(res.b?.lines) ? res.b!.lines : [],
      online: !!res.b?.online,
      message: '',
    };
  }

  // 游客被服务端拒绝时，改用命令桥；正式账号的错误原样返回（密码失效、桥未启用等）
  if (!cfg.guest || (res.m !== 'GUEST_READONLY' && res.m !== 'MUSIC_NO_PLAYER')) {
    return { ok: false, lines: [], online: false, message: res.m ?? '' };
  }
  try {
    const command = ['music', cmd, ...args].filter(Boolean).join(' ');
    const r = await bridgeMusic(cfg, command, cmd === 'search' ? 3500 : 800);
    let ok = r.ok;
    let message = r.error;
    if (ok && r.lines.some((l) => l.includes('没有播放的玩家'))) {
      ok = false;
      message = 'NO_MUSIC_SESSION';
    }
    return { ok, lines: r.lines, online: r.online, message: ok ? '' : message || 'MUSIC_BAD_RESPONSE' };
  } catch (e: any) {
    return { ok: false, lines: [], online: false, message: String(e?.message ?? 'BRIDGE_UNAVAILABLE') };
  }
}

/**
 * `@` 补全的候选：在线玩家 + 最近用过的 App 昵称。
 * 走共享长连接（聊天页本来就连着），失败时静默返回空表，不打断输入。
 */
export interface PlayersResp {
  /** 当前在线的游戏玩家 */
  mc: string[];
  /** 最近在 App 里说过话的昵称（服务端内存里只留 64 个） */
  app: string[];
}

export async function fetchPlayers(cfg: ServerConfig): Promise<PlayersResp> {
  try {
    const res = await tcp.request<{ mc?: string[]; app?: string[] }>(cfg, 'players');
    return {
      mc: Array.isArray(res.b?.mc) ? res.b!.mc : [],
      app: Array.isArray(res.b?.app) ? res.b!.app : [],
    };
  } catch {
    return { mc: [], app: [] };
  }
}

/**
 * 推送帧信封（和 2.1.0 的 SSE 帧一模一样，只是外面多包了一层 TCP 帧）。
 *
 * - `f` 全量：`d` 是数组形式的条目，`n` 是稀疏 NBT（下标 → base64）
 * - `d` 增量：`c` 变更 / `a` 新增 / `x` 删除
 * - `k` 心跳：内容没变
 * - `e` 错误
 */
export type SseFrame =
  | { t: 'f'; sid: string; seq: number; d: any[]; n?: Record<string, string> }
  | { t: 'd'; sid?: string; seq: number; c?: any[]; a?: any[]; x?: any[] }
  | { t: 'k'; seq: number }
  | { t: 'e'; m: string };

export function parseFrame(data: unknown): SseFrame | null {
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    if (obj && typeof obj === 'object' && typeof (obj as any).t === 'string') return obj as SseFrame;
    return null;
  } catch {
    return null;
  }
}

/** 流体滴在物品列表里的统一 name（AE2FC 约定），多条不同流体共用它 */
export const FLUID_DROP = 'ae2fc:fluid_drop';
/** 源质（神秘时代）在物品列表里的统一 name，多条不同要素共用它 */
export const ESSENTIA = 'thaumicenergistics:essentia';

/**
 * 物品键。**流体滴必须带 NBT** —— 所有流体共用 `ae2fc:fluid_drop:0`，
 * 只用 name|meta 做键的话它们会在 map 里互相覆盖，App 里永远只看到最后一条流体。
 * 其它物品故意不带 NBT（否则几千个附魔剑会变成几千行）。
 * 规则必须和服务端 StreamState.key 一致。
 */
export function itemKey(name: string, meta: number, nbt?: string | null): string {
  if (nbt && (name === FLUID_DROP || name === ESSENTIA)) return `${name}|${meta}|${nbt}`;
  return `${name}|${meta}`;
}

export { normalizeToken } from './auth';
