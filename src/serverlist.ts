// 服务器线路列表：内置三条 + 可在线获取的列表（地址可配置），合并去重后给账号页做选择器。
import * as SecureStore from 'expo-secure-store';
import { readCache, writeCache } from './cache';
import { isValidHttpUrl, normalizeRepoUrl } from './urlutil';
import { DEFAULT_PORT } from './api';

export interface ServerEntry {
  host: string;
  port: string;
  /** 线路名，如「肥猫线」 */
  name: string;
  /** 补充说明，如「IPv6 线」 */
  tag?: string;
  source: 'builtin' | 'online';
}

/** 在线列表的默认地址（与图标库同一个 ae 目录） */
export const DEFAULT_SERVER_LIST_URL =
  'https://git.dafeimao.net/huaxidesu/dsmgtnhupdate/raw/branch/main/ae/servers.json';

/** 随 App 分发的默认线路；在线列表里同 host:port 的条目会覆盖这里的名字 */
export const BUILTIN_SERVERS: ServerEntry[] = [
  { host: 'mc6.dafeimao.net', port: DEFAULT_PORT, name: '默认', tag: 'IPv6 线', source: 'builtin' },
  { host: 'mc.dafeimao.net', port: DEFAULT_PORT, name: '肥猫线', source: 'builtin' },
  { host: 'mc1.dafeimao.net', port: DEFAULT_PORT, name: '华溪线', source: 'builtin' },
];

const KEY_URL = 'servers.list_url';
const CACHE_KEY = 'servers:global';

// ---- 更新源地址 ----

/** 进程内镜像：expo-secure-store 只有异步删除，删完立刻读会拿到旧值 */
let listUrlCache: string | null | undefined;

function readStoredUrl(): string | null {
  if (listUrlCache === undefined) listUrlCache = SecureStore.getItem(KEY_URL);
  return listUrlCache;
}

export function getServerListUrl(): string {
  return readStoredUrl() || DEFAULT_SERVER_LIST_URL;
}

export function isCustomServerListUrl(): boolean {
  return !!readStoredUrl();
}

/** 保存在线列表地址；传空串恢复默认。返回实际生效的地址（已规范化）。 */
export function setServerListUrl(input: string): string {
  const url = input.trim() ? normalizeRepoUrl(input, 'servers.json') : '';
  if (!url || url === DEFAULT_SERVER_LIST_URL) {
    listUrlCache = null;
    SecureStore.deleteItemAsync(KEY_URL).catch(() => undefined);
    return DEFAULT_SERVER_LIST_URL;
  }
  listUrlCache = url;
  SecureStore.setItem(KEY_URL, url);
  return url;
}

export function isValidServerListUrl(input: string): boolean {
  return isValidHttpUrl(input);
}

// ---- 清单 ----

export interface ServerListManifest {
  schema?: number;
  updated?: string;
  note?: string;
  defaultPort?: number | string;
  servers?: { name?: string; host?: string; port?: number | string; tag?: string }[];
}

/** 在线清单 → 线路条目；脏数据（缺 host）直接丢掉 */
export function toEntries(m: ServerListManifest): ServerEntry[] {
  const fallbackPort = String(m.defaultPort ?? DEFAULT_PORT);
  return (m.servers ?? [])
    .filter((s) => !!s?.host)
    .map((s) => ({
      host: String(s.host).trim(),
      port: String(s.port ?? fallbackPort),
      name: (s.name ?? '').trim() || String(s.host),
      tag: s.tag?.trim() || undefined,
      source: 'online' as const,
    }));
}

/** 内置 + 在线合并：同 host:port 以在线条目为准（运营可以改线路名），顺序按内置在前 */
export function mergeServers(online: ServerEntry[]): ServerEntry[] {
  const map = new Map<string, ServerEntry>();
  for (const e of BUILTIN_SERVERS) map.set(`${e.host}:${e.port}`, e);
  for (const e of online) map.set(`${e.host}:${e.port}`, e);
  return [...map.values()];
}

/** 当前地址命中哪条线路；没命中返回 null（说明是手动填的地址） */
export function entryForHost(host: string, port: string, entries: ServerEntry[] = BUILTIN_SERVERS): ServerEntry | null {
  const h = host.trim().toLowerCase();
  return entries.find((e) => e.host.toLowerCase() === h && e.port === port) ?? null;
}

export async function fetchServerList(url = getServerListUrl()): Promise<ServerEntry[]> {
  // 地址填错或服务器不响应时不能让界面一直转圈
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: controller.signal });
    if (!resp.ok) throw new Error(`列表请求失败 HTTP ${resp.status}`);
    const data = (await resp.json()) as ServerListManifest;
    const entries = toEntries(data);
    if (entries.length === 0) throw new Error('列表里没有可用线路');
    writeCache(CACHE_KEY, data);
    return entries;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('列表请求超时，请检查地址');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 上次成功获取的在线列表（离线时用它兜底） */
export async function loadCachedServerList(): Promise<{ entries: ServerEntry[]; at: number } | null> {
  const hit = await readCache<ServerListManifest>(CACHE_KEY);
  if (!hit) return null;
  const entries = toEntries(hit.data);
  return entries.length > 0 ? { entries, at: hit.at } : null;
}
