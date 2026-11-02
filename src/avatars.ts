// 游戏内玩家头像：解析（Mojang 优先，LittleSkin 后备）→ 下载皮肤 → 本地缓存 30 天。
//
// 只服务 kind 0/2/3（游戏内发言、加入、退出）；App 消息永远走默认头像，避免把
// 自定义昵称当成正版 ID 去查别人。
//
// 缓存分两层：
//   - SQLite `aemobile-avatar.db`：name → uuid/skin_uri/fetched_at/fail_until
//   - 文件 `documentDirectory/avatars/<source>-<uuid>.png`
// 过期后台刷新；刷新失败继续用旧图，不会突然退回默认头像。
import { useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { Buffer } from 'buffer';
import { APP_VERSION } from './appinfo';
import {
  littleSkinNameUrl,
  littleSkinProfileUrl,
  mojangNameUrl,
  mojangProfileUrl,
  profileId,
  textureUrlFromProfile,
} from './avatarurl';

/** 缓存 30 天（已批准） */
export const AVATAR_TTL_MS = 30 * 24 * 3600 * 1000;
/** 查无此人/网络失败后 6 小时内不再试，避免每次滚动都打接口 */
export const AVATAR_FAIL_TTL_MS = 6 * 3600 * 1000;
const REQUEST_GAP_MS = 250;
const FETCH_TIMEOUT_MS = 8000;
const AVATAR_DIR = `${FileSystem.documentDirectory}avatars/`;

export interface AvatarState {
  /** 本地皮肤 PNG 的 file:// URI；null 表示还没拿到，用默认头像 */
  uri: string | null;
  loading: boolean;
  /** 默认头像用的首字符 */
  letter: string;
  /** 默认头像的稳定底色 */
  color: string;
}

interface MetaRow {
  name: string;
  uuid: string;
  source: string;
  skin_uri: string;
  fetched_at: number;
  fail_until: number;
}

interface Entry {
  uri: string | null;
  loading: boolean;
}

const COLORS = ['#5B8DEF', '#3BB273', '#C77DFF', '#F2994A', '#EB5757', '#2D9CDB', '#9B51E0', '#56CCF2'];

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<void>>();
let chain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;
let generation = 0;
let db: SQLite.SQLiteDatabase | null = null;

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}

export function letterOf(name: string | null | undefined): string {
  const chars = Array.from((name ?? '').trim());
  return chars.length > 0 ? chars[0].toUpperCase() : '?';
}

/** 按名字算一个稳定底色（同名永远同色） */
export function colorForName(name: string | null | undefined): string {
  const s = (name ?? '').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return COLORS[h % COLORS.length];
}

function openDb(): SQLite.SQLiteDatabase {
  if (db) return db;
  const d = SQLite.openDatabaseSync('aemobile-avatar.db');
  d.execSync(
    `PRAGMA journal_mode = WAL;
     CREATE TABLE IF NOT EXISTS avatar (
       name       TEXT PRIMARY KEY,
       uuid       TEXT NOT NULL DEFAULT '',
       source     TEXT NOT NULL DEFAULT '',
       skin_uri   TEXT NOT NULL DEFAULT '',
       fetched_at INTEGER NOT NULL DEFAULT 0,
       fail_until INTEGER NOT NULL DEFAULT 0
     );`,
  );
  db = d;
  return d;
}

function readRow(key: string): MetaRow | null {
  try {
    return (
      openDb().getFirstSync<MetaRow>(
        'SELECT name, uuid, source, skin_uri, fetched_at, fail_until FROM avatar WHERE name = ?',
        key,
      ) ?? null
    );
  } catch (e) {
    console.warn('[avatar] read failed', e);
    return null;
  }
}

function saveRow(row: MetaRow): void {
  try {
    openDb().runSync(
      `INSERT INTO avatar (name, uuid, source, skin_uri, fetched_at, fail_until)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         uuid = excluded.uuid,
         source = excluded.source,
         skin_uri = excluded.skin_uri,
         fetched_at = excluded.fetched_at,
         fail_until = excluded.fail_until`,
      row.name,
      row.uuid,
      row.source,
      row.skin_uri,
      row.fetched_at,
      row.fail_until,
    );
  } catch (e) {
    console.warn('[avatar] save failed', e);
  }
}

function markFail(key: string, until: number): void {
  try {
    openDb().runSync(
      `INSERT INTO avatar (name, uuid, source, skin_uri, fetched_at, fail_until)
       VALUES (?, '', '', '', 0, ?)
       ON CONFLICT(name) DO UPDATE SET fail_until = excluded.fail_until`,
      key,
      until,
    );
  } catch {
    // 缓存写不进去不影响本次显示
  }
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // 单个订阅者异常不影响其他行
    }
  }
}

function setEntry(key: string, uri: string | null, loading: boolean): void {
  const prev = entries.get(key);
  if (prev && prev.uri === uri && prev.loading === loading) return;
  entries.set(key, { uri, loading });
  notify();
}

function snapshot(key: string): Entry {
  return entries.get(key) ?? { uri: null, loading: false };
}

function firstUri(key: string): string | null {
  return snapshot(key).uri;
}

// ---------------------------------------------------------------- 网络

async function fetchJson(url: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': `AEMobile/${APP_VERSION}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface Skin {
  source: 'mojang' | 'littleskin';
  uuid: string;
  skinUrl: string;
}

async function resolveSkin(name: string): Promise<Skin | null> {
  const mojangId = profileId(await fetchJson(mojangNameUrl(name)));
  if (mojangId) {
    const url = textureUrlFromProfile(await fetchJson(mojangProfileUrl(mojangId)));
    if (url) return { source: 'mojang', uuid: mojangId, skinUrl: url };
  }
  const lsId = profileId(await fetchJson(littleSkinNameUrl(name)));
  if (lsId) {
    const url = textureUrlFromProfile(await fetchJson(littleSkinProfileUrl(lsId)));
    if (url) return { source: 'littleskin', uuid: lsId, skinUrl: url };
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 所有网络请求串行 + 250ms 间隔，避免滚动时几十行同时打 Mojang */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function downloadSkin(skin: Skin): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(skin.skinUrl, {
      signal: ctrl.signal,
      headers: { 'User-Agent': `AEMobile/${APP_VERSION}` },
    });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // 只接受真正的 PNG 头，避免 CDN 返回 200 的 HTML 错误页被当成皮肤
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
      return null;
    }
    await FileSystem.makeDirectoryAsync(AVATAR_DIR, { intermediates: true }).catch(() => undefined);
    const uri = `${AVATAR_DIR}${skin.source}-${skin.uuid}.png`;
    await FileSystem.writeAsStringAsync(uri, Buffer.from(bytes).toString('base64'), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return uri;
  } catch (e) {
    console.warn('[avatar] download failed', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- 调度

async function step(name: string, key: string): Promise<void> {
  const gen = generation;
  const row = readRow(key);
  const now = Date.now();

  if (row && row.skin_uri) {
    let exists = false;
    try {
      exists = (await FileSystem.getInfoAsync(row.skin_uri)).exists;
    } catch {
      exists = false;
    }
    if (exists) {
      if (gen === generation) setEntry(key, row.skin_uri, false);
      if (now - row.fetched_at < AVATAR_TTL_MS) return; // 新鲜，直接收工
    }
  }

  if (row && row.fail_until > now && (!row.skin_uri || now - row.fetched_at >= AVATAR_TTL_MS)) {
    return; // 最近刚失败过，先用旧图/默认图
  }

  if (gen === generation) setEntry(key, firstUri(key), true);
  try {
    const skin = await enqueue(() => resolveSkin(name));
    if (!skin) {
      markFail(key, Date.now() + AVATAR_FAIL_TTL_MS);
      return;
    }
    const uri = await enqueue(() => downloadSkin(skin));
    if (!uri) {
      markFail(key, Date.now() + AVATAR_FAIL_TTL_MS);
      return;
    }
    if (gen !== generation) return;
    saveRow({
      name: key,
      uuid: skin.uuid,
      source: skin.source,
      skin_uri: uri,
      fetched_at: Date.now(),
      fail_until: 0,
    });
    setEntry(key, uri, false);
  } catch (e) {
    console.warn('[avatar] resolve failed', e);
    markFail(key, Date.now() + AVATAR_FAIL_TTL_MS);
  } finally {
    if (gen === generation) {
      const cur = snapshot(key);
      if (cur.loading) setEntry(key, cur.uri, false);
    }
  }
}

function ensureAvatar(name: string): void {
  const key = keyOf(name);
  if (!key || inFlight.has(key)) return;
  inFlight.set(
    key,
    step(name, key).finally(() => inFlight.delete(key)),
  );
}

/**
 * 订阅某个玩家的头像。`enabled=false` 时完全不发请求（App 消息传 false）。
 * 返回值在缓存命中/刷新完成时会自动更新。
 */
export function useAvatar(name: string | null | undefined, enabled = true): AvatarState {
  const key = name ? keyOf(name) : '';
  const [entry, setEntryState] = useState<Entry>(() => snapshot(key));

  useEffect(() => {
    if (!key) {
      setEntryState({ uri: null, loading: false });
      return;
    }
    const sync = () => setEntryState(snapshot(key));
    listeners.add(sync);
    sync();
    if (enabled) ensureAvatar(name as string);
    return () => {
      listeners.delete(sync);
    };
  }, [key, enabled, name]);

  return {
    // App 消息（enabled=false）永远用默认头像，即使缓存里有同名游戏玩家的皮肤
    uri: enabled ? entry.uri : null,
    loading: entry.loading,
    letter: letterOf(name),
    color: colorForName(name),
  };
}

/** 图片加载失败时把缓存标记作废，下一次挂载重新下载；当前立刻回退默认头像 */
export function invalidateAvatar(name: string | null | undefined): void {
  const key = name ? keyOf(name) : '';
  if (!key) return;
  const prev = entries.get(key);
  if (prev && prev.uri === null && !prev.loading) return;
  entries.set(key, { uri: null, loading: false });
  notify();
  try {
    openDb().runSync('DELETE FROM avatar WHERE name = ?', key);
  } catch {
    // 数据库没打开过就只在内存里作废
  }
}

// ---------------------------------------------------------------- 缓存管理

export async function avatarCacheStats(): Promise<{ bytes: number; count: number }> {
  try {
    const names = await FileSystem.readDirectoryAsync(AVATAR_DIR);
    let bytes = 0;
    let count = 0;
    for (const n of names) {
      if (!n.endsWith('.png')) continue;
      try {
        const info = await FileSystem.getInfoAsync(`${AVATAR_DIR}${n}`);
        if (info.exists && !info.isDirectory) {
          bytes += info.size ?? 0;
          count += 1;
        }
      } catch {
        // 单个文件读不到就跳过
      }
    }
    return { bytes, count };
  } catch {
    return { bytes: 0, count: 0 };
  }
}

export async function clearAvatarCache(): Promise<void> {
  generation += 1;
  entries.clear();
  inFlight.clear();
  notify();
  try {
    await FileSystem.deleteAsync(AVATAR_DIR, { idempotent: true });
  } catch {
    // 目录不存在也无所谓
  }
  try {
    openDb().runSync('DELETE FROM avatar');
  } catch {
    // 数据库没打开过就不用清
  }
}
