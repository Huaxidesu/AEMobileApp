// 服务器数据的落盘缓存：冷启动与离线时先出内容，联网后由新数据覆盖。
// 缓存键带服务器与主网指纹，换服、换主网不会串数据；同一键的写入串行执行，避免并发写坏文件。
import * as FileSystem from 'expo-file-system';
import { ServerConfig } from './api';

const CACHE_DIR = `${FileSystem.documentDirectory}cache/`;

/** 缓存文件结构版本：字段格式变更时自增，旧文件按未命中处理 */
const CACHE_VERSION = 1;

/** 缓存分类，用于设置页的分类占用统计 */
export type CacheCategory = 'items' | 'cpus' | 'details' | 'mspt' | 'networks' | 'servers';

export const CACHE_CATEGORY_LABEL: Record<CacheCategory, string> = {
  items: '物品列表',
  cpus: '合成 CPU',
  details: '合成明细',
  mspt: '服务器监控',
  networks: '网络列表',
  servers: '服务器列表',
};

export interface CacheEntry<T> {
  v: number;
  /** 写入时间（毫秒时间戳） */
  at: number;
  /** 原始缓存键（文件名是哈希，留一份便于排查） */
  key: string;
  data: T;
}

/** 只按服务器区分的指纹，用于与主网无关的数据（如网络列表） */
export function serverKey(cfg: ServerConfig): string {
  return `${cfg.ip}:${cfg.port}#${(cfg.token || '').slice(0, 8)}`;
}

/**
 * 服务器与主网指纹，作为大部分缓存键的作用域。
 * 物品列表、合成 CPU 都是按主网查询的，主网变了缓存必须区分开。
 */
export function scopeKey(cfg: ServerConfig): string {
  const net = cfg.mainnet ? `${cfg.mainnet.dimid}/${cfg.mainnet.x}/${cfg.mainnet.y}/${cfg.mainnet.z}` : 'none';
  return `${serverKey(cfg)}#${net}`;
}

function fileFor(key: string): string {
  // 键里有 :// # / 等字符，直接用会破坏文件路径（百分号编码还会被文件系统解码回分隔符），
  // 因此文件名只用「分类 + 短哈希」，原始键存在文件内容里
  return `${CACHE_DIR}${categoryOf(key)}-${hashKey(key)}.json`;
}

/** FNV-1a 32 位哈希：只需区分少量缓存键，不做安全用途 */
function hashKey(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function categoryOf(key: string): CacheCategory | 'other' {
  const head = key.split(':')[0];
  return head in CACHE_CATEGORY_LABEL ? (head as CacheCategory) : 'other';
}

// ---- 读写 ----

/** 缓存超过这个时间就当未命中：物品列表几百 KB 起步，留一周足够，再老的内容反而误导人 */
const CACHE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export async function readCache<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const info = await FileSystem.getInfoAsync(fileFor(key));
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(fileFor(key))) as CacheEntry<T>;
    if (!parsed || parsed.v !== CACHE_VERSION) return null;
    // 过期当未命中（以前没有过期，换过服务器后旧缓存会一直留着占空间）
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    // 文件损坏或不可读：当作没有缓存，不影响联网流程
    return null;
  }
}

const writeChains = new Map<string, Promise<void>>();
const lastWritten = new Map<string, number>();
/** 节流窗口内收到的最新数据：窗口结束时补写这一份 */
const pendingData = new Map<string, unknown>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * 真正落盘。序列化（几 MB 的 JSON.stringify）放到 setTimeout 里跑，
 * 避免卡住调用方的渲染帧 —— 以前是在 setRaw 之后同步 stringify，会掉帧。
 */
function flush(key: string, data: unknown, at: number): Promise<void> {
  const prev = writeChains.get(key) ?? Promise.resolve();
  const next = prev.then(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          (async () => {
            try {
              await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(() => undefined);
              const payload: CacheEntry<unknown> = { v: CACHE_VERSION, at, key, data };
              await FileSystem.writeAsStringAsync(fileFor(key), JSON.stringify(payload));
            } catch {
              // 磁盘写失败（空间不足等）只影响下次冷启动，不打断当前使用
            } finally {
              resolve();
            }
          })();
        }, 0);
      }),
  );
  writeChains.set(key, next);
  return next;
}

/**
 * 写入缓存。
 *
 * @param minInterval 最小写入间隔（毫秒）。高频帧用它限制写盘次数，0 表示不限。
 *
 * 节流语义是「窗口内只写最后一次」（trailing）：以前是窗口内直接 return，
 * 于是 cpus/details 这类高频流在断线瞬间的最后一次状态永远落不了盘。
 */
export function writeCache<T>(key: string, data: T, minInterval = 0): Promise<void> {
  const now = Date.now();
  const last = lastWritten.get(key) ?? 0;
  if (minInterval > 0 && now - last < minInterval) {
    pendingData.set(key, data);
    if (!pendingTimers.has(key)) {
      const wait = Math.max(16, minInterval - (now - last));
      const timer = setTimeout(() => {
        pendingTimers.delete(key);
        const latest = pendingData.get(key);
        pendingData.delete(key);
        if (latest === undefined) return;
        lastWritten.set(key, Date.now());
        flush(key, latest, Date.now());
      }, wait);
      pendingTimers.set(key, timer);
    }
    return Promise.resolve();
  }
  lastWritten.set(key, now);
  return flush(key, data, now);
}

// ---- 统计与清理 ----

export interface CacheStat {
  /** 文件名（分类 + 短哈希） */
  file: string;
  category: CacheCategory | 'other';
  bytes: number;
  /** 最后写入时间（毫秒），取文件修改时间 */
  at: number;
}

export interface CacheSummary {
  total: number;
  count: number;
  byCategory: Record<CacheCategory | 'other', { bytes: number; count: number }>;
}

export async function listCache(): Promise<CacheStat[]> {
  try {
    const names = await FileSystem.readDirectoryAsync(CACHE_DIR);
    const out: CacheStat[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const uri = `${CACHE_DIR}${name}`;
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || info.isDirectory) continue;
      const head = name.split('-')[0];
      out.push({
        file: name,
        category: head in CACHE_CATEGORY_LABEL ? (head as CacheCategory) : 'other',
        bytes: info.size ?? 0,
        at: (info.modificationTime ?? 0) * 1000,
      });
    }
    return out.sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export async function summarizeCache(): Promise<CacheSummary> {
  const empty = { bytes: 0, count: 0 };
  const summary: CacheSummary = {
    total: 0,
    count: 0,
    byCategory: { items: { ...empty }, cpus: { ...empty }, details: { ...empty }, mspt: { ...empty }, networks: { ...empty }, servers: { ...empty }, other: { ...empty } },
  };
  for (const s of await listCache()) {
    summary.total += s.bytes;
    summary.count += 1;
    const bucket = summary.byCategory[s.category];
    bucket.bytes += s.bytes;
    bucket.count += 1;
  }
  return summary;
}

/** 清空全部数据缓存（不动服务器配置与图标库） */
export async function clearCache(): Promise<void> {
  writeChains.clear();
  lastWritten.clear();
  pendingData.clear();
  // 挂着的补写定时器要先取消，否则清完又被写回来
  for (const t of pendingTimers.values()) clearTimeout(t);
  pendingTimers.clear();
  try {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
  } catch {
    // 目录不存在或删不掉时保持原样
  }
}

// ---- 展示辅助 ----

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function formatAgo(ts: number | null | undefined): string {
  if (!ts) return '';
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return '刚刚';
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}
