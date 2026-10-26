// 图标库在线更新：从自建 Gitea 拉 version.json，比对 sha256，下载后校验并切换数据库。
// 数据库文件统一放 expo-sqlite 的目录（documentDirectory/SQLite），按 hash 命名，切换时无需重启 App。
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseAsync } from 'expo-sqlite';
import { isValidHttpUrl, normalizeRepoUrl } from './urlutil';

/** 随 APK 分发的内置库（assets/itempanel.db，首次启动由 SQLiteProvider 复制进来） */
export const BUILTIN_DB = 'itempanel.db';

/**
 * 内置库的 sha256。重建 assets/itempanel.db 后必须同步改这里，
 * 否则装完新 APK 还会提示"有更新"（buildiconpack.py 会把这个值打印出来）。
 */
export const BUILTIN_ICON_SHA = 'e073b0ab6083322475f0ba4f9defe18d56b3ade18213e26940a2fa60b275e13d';

/** 默认清单地址（自建 Gitea 的 ae/ 目录 raw 直链；可用 EXPO_PUBLIC_ICON_MANIFEST_URL 覆盖，便于换镜像/本地联调） */
export const DEFAULT_MANIFEST_URL =
  process.env.EXPO_PUBLIC_ICON_MANIFEST_URL ||
  'https://git.dafeimao.net/huaxidesu/dsmgtnhupdate/raw/branch/main/ae/version.json';

const DB_DIR = `${FileSystem.documentDirectory}SQLite/`;
const TMP_FILE = `${FileSystem.cacheDirectory}iconpack.download`;

const KEY_ACTIVE = 'icons.active_db';
const KEY_META = 'icons.meta';
const KEY_URL = 'icons.manifest_url';

/**
 * 把用户填的地址规范成 version.json 的直链。
 * 常见输入是 Gitea 的网页地址 `.../src/branch/main/ae`，需要换成 `.../raw/branch/main/ae`；
 * 目录地址补上 `version.json`，已经是 .json 的原样使用。
 */
export function normalizeManifestUrl(input: string): string {
  return normalizeRepoUrl(input, 'version.json') || DEFAULT_MANIFEST_URL;
}

export function isValidManifestUrl(url: string): boolean {
  return isValidHttpUrl(url);
}

export interface IconPackInfo {
  version: string;
  sha256: string;
  size: number;
  file: string;
  rows: number;
  keys: number;
  fluids: number;
  gzFile?: string;
  gzSize?: number;
}

export interface RemoteManifest {
  schema: number;
  updated: string;
  note?: string;
  icons: IconPackInfo;
}

export interface InstalledInfo {
  /** null = 用的内置库 */
  version: string | null;
  sha256: string | null;
  size: number | null;
  dbName: string;
}

// ---- 当前生效的库 / 清单地址 ----

/**
 * 更新源的进程内镜像。expo-secure-store 只有异步删除接口，
 * 靠这层缓存保证「恢复默认」之后读到的值立刻是默认值。
 */
let manifestUrlCache: string | null | undefined;

export function getManifestUrl(): string {
  if (manifestUrlCache === undefined) manifestUrlCache = SecureStore.getItem(KEY_URL);
  return manifestUrlCache || DEFAULT_MANIFEST_URL;
}

/** 是否在用自定义更新源（否则走默认源） */
export function isCustomManifestUrl(): boolean {
  return !!getManifestUrlCacheRaw();
}

function getManifestUrlCacheRaw(): string | null {
  if (manifestUrlCache === undefined) manifestUrlCache = SecureStore.getItem(KEY_URL);
  return manifestUrlCache;
}

/** 保存自定义更新源；传空串恢复默认。返回实际生效的地址（已规范化）。 */
export function setManifestUrl(input: string): string {
  const url = input.trim() ? normalizeManifestUrl(input) : '';
  // 填的就是默认源时按"未自定义"处理，避免"恢复默认"按钮无意义地亮着
  if (!url || url === DEFAULT_MANIFEST_URL) {
    manifestUrlCache = null;
    SecureStore.deleteItemAsync(KEY_URL).catch(() => undefined);
    return DEFAULT_MANIFEST_URL;
  }
  manifestUrlCache = url;
  SecureStore.setItem(KEY_URL, url);
  return url;
}

export function getActiveDb(): string {
  return SecureStore.getItem(KEY_ACTIVE) || BUILTIN_DB;
}

export function getInstalledInfo(): InstalledInfo {
  const dbName = getActiveDb();
  if (dbName === BUILTIN_DB) return { version: null, sha256: null, size: null, dbName };
  try {
    const meta = JSON.parse(SecureStore.getItem(KEY_META) || 'null');
    return {
      version: meta?.version ?? null,
      sha256: meta?.sha256 ?? null,
      size: meta?.size ?? null,
      dbName,
    };
  } catch {
    return { version: null, sha256: null, size: null, dbName };
  }
}

// 切换即时生效：App.tsx 订阅这里，改完直接换 SQLiteProvider 的 key
const dbListeners = new Set<() => void>();

export function subscribeActiveDb(fn: () => void): () => void {
  dbListeners.add(fn);
  return () => dbListeners.delete(fn);
}

function setActiveDb(name: string, meta?: { version: string; sha256: string; size: number } | null) {
  if (name === BUILTIN_DB) {
    // 写回内置库名而不是删除：SecureStore 没有同步删除接口，删除后紧跟的读取会读到旧值
    SecureStore.setItem(KEY_ACTIVE, BUILTIN_DB);
    SecureStore.deleteItemAsync(KEY_META).catch(() => undefined);
  } else {
    SecureStore.setItem(KEY_ACTIVE, name);
    if (meta) SecureStore.setItem(KEY_META, JSON.stringify(meta));
  }
  dbListeners.forEach((fn) => fn());
}

/** 恢复成随包内置的库（内置库文件一直在，不需要重新下载） */
export function restoreBuiltin(): void {
  setActiveDb(BUILTIN_DB);
}

/** 启动时确认当前库文件还在；外部清理/异常时退回内置库 */
export async function resolveActiveDb(): Promise<string> {
  const name = getActiveDb();
  if (name === BUILTIN_DB) return name;
  const info = await FileSystem.getInfoAsync(`${DB_DIR}${name}`);
  if (info.exists) return name;
  setActiveDb(BUILTIN_DB);
  return BUILTIN_DB;
}

// ---- 远端清单 ----

export async function fetchManifest(url = getManifestUrl()): Promise<RemoteManifest> {
  // 清单地址填错或服务器不响应时不能让界面一直转圈
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: controller.signal });
    if (!resp.ok) throw new Error(`清单请求失败 HTTP ${resp.status}`);
    const data = (await resp.json()) as RemoteManifest;
    if (!data?.icons?.sha256) throw new Error('清单格式不对：缺少 icons.sha256');
    return data;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('清单请求超时，请检查更新源地址');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 清单里的库和本地是不是同一个（用 sha256 判定，不看版本号排序） */
export function hasUpdate(manifest: RemoteManifest): boolean {
  const installed = getInstalledInfo();
  const localSha = installed.version == null ? BUILTIN_ICON_SHA : installed.sha256;
  return localSha !== manifest.icons.sha256;
}

function fileUrlFor(base: string, file: string): string {
  // 清单地址形如 .../ae/version.json，图标文件是相对 ae/ 的路径
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  return `${dir}${file}`;
}

// ---- 下载 / 校验 / 安装 ----

export interface DownloadOptions {
  onProgress?: (ratio: number, bytes: number, total: number) => void;
}

export async function downloadAndInstall(
  manifest: RemoteManifest,
  options: DownloadOptions = {},
): Promise<{ dbName: string; version: string }> {
  const info = manifest.icons;
  const url = fileUrlFor(getManifestUrl(), info.file);
  const target = `${DB_DIR}icons-${info.sha256.slice(0, 12)}.db`;

  await FileSystem.makeDirectoryAsync(DB_DIR, { intermediates: true }).catch(() => undefined);
  await FileSystem.deleteAsync(TMP_FILE, { idempotent: true });

  const resumable = FileSystem.createDownloadResumable(url, TMP_FILE, {}, (p) => {
    const total = p.totalBytesExpectedToWrite || info.size;
    options.onProgress?.(total ? p.totalBytesWritten / total : 0, p.totalBytesWritten, total);
  });
  const result = await resumable.downloadAsync();
  if (!result?.uri) throw new Error('下载中断');

  const stat = await FileSystem.getInfoAsync(result.uri);
  const size = stat.exists && !stat.isDirectory ? stat.size : 0;
  if (info.size && size !== info.size) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new Error(`文件大小不符：${size} != ${info.size}`);
  }

  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: result.uri, to: target });

  const dbName = target.slice(DB_DIR.length);
  try {
    await verifyDatabase(dbName, info.rows);
  } catch (e) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw e;
  }

  setActiveDb(dbName, { version: info.version, sha256: info.sha256, size: info.size });
  cleanupOldPacks(dbName);
  return { dbName, version: info.version };
}

/** 打开一遍确认不是坏文件：表结构 + 行数 + SQLite 自检 */
async function verifyDatabase(dbName: string, expectRows: number): Promise<void> {
  const db = await openDatabaseAsync(dbName);
  try {
    const row = await db.getFirstAsync<{ c: number }>('select count(*) as c from item_panel');
    const check = await db.getFirstAsync<{ quick_check: string }>('pragma quick_check(1)');
    if (!row || row.c === 0) throw new Error('图标库为空，已丢弃');
    if (expectRows && row.c !== expectRows) throw new Error(`行数不符：${row.c} != ${expectRows}`);
    if (check && check.quick_check !== 'ok') throw new Error(`完整性检查失败：${check.quick_check}`);
  } finally {
    await db.closeAsync();
  }
}

/** 删掉除当前库以外的旧图标包（内置库不动） */
async function cleanupOldPacks(keep: string): Promise<void> {
  try {
    const files = await FileSystem.readDirectoryAsync(DB_DIR);
    for (const f of files) {
      if (f.startsWith('icons-') && f.endsWith('.db') && f !== keep) {
        await FileSystem.deleteAsync(`${DB_DIR}${f}`, { idempotent: true });
        await FileSystem.deleteAsync(`${DB_DIR}${f}-wal`, { idempotent: true });
        await FileSystem.deleteAsync(`${DB_DIR}${f}-shm`, { idempotent: true });
      }
    }
  } catch {
    // 清理失败不影响使用
  }
}

// ---- 空间统计与清理 ----

/** 在线图标库占用的空间：当前库 + 残留旧库 + 临时下载文件 */
export async function getOnlinePackBytes(): Promise<number> {
  let total = 0;
  try {
    for (const f of await FileSystem.readDirectoryAsync(DB_DIR)) {
      if (!f.startsWith('icons-')) continue;
      const info = await FileSystem.getInfoAsync(`${DB_DIR}${f}`);
      if (info.exists && !info.isDirectory) total += info.size ?? 0;
    }
  } catch {
    // 目录还不存在
  }
  try {
    const tmp = await FileSystem.getInfoAsync(TMP_FILE);
    if (tmp.exists && !tmp.isDirectory) total += tmp.size ?? 0;
  } catch {
    // 没有临时文件
  }
  return total;
}

/** 删除所有在线图标库并切回内置库（内置库随 APK 分发，不受影响） */
export async function removeOnlinePacks(): Promise<void> {
  setActiveDb(BUILTIN_DB);
  // 切库后 App 会重挂 SQLiteProvider，等旧连接释放再删文件
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    for (const f of await FileSystem.readDirectoryAsync(DB_DIR)) {
      if (f.startsWith('icons-')) await FileSystem.deleteAsync(`${DB_DIR}${f}`, { idempotent: true });
    }
  } catch {
    // 删不掉时保留文件，下次启动会按 active_db 忽略它们
  }
  await FileSystem.deleteAsync(TMP_FILE, { idempotent: true }).catch(() => undefined);
}
