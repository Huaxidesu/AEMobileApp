// 图标库在线更新：从自建 Gitea 拉 version.json，比对 sha256，下载后校验并切换数据库。
// 数据库文件统一放 expo-sqlite 的目录（documentDirectory/SQLite），按 hash 命名，切换时无需重启 App。
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Asset } from 'expo-asset';
import { openDatabaseAsync } from 'expo-sqlite';
import { isValidHttpUrl, normalizeRepoUrl } from './urlutil';

/** 内置图标包（编译期嵌入，默认空）。见 src/bundled.ts 与 tools/embed_pack.py */
import { BUNDLED_PACKS } from './bundled';

/** 没有默认更新源：服主自己搭一个，玩家在设置里填，或从配置包导入 */
export const DEFAULT_MANIFEST_URL = process.env.EXPO_PUBLIC_ICON_MANIFEST_URL || '';

const DB_DIR_URI = `${FileSystem.documentDirectory}SQLite/`;
/** ATTACH 要真实路径，不能带 file://（FileSystem.documentDirectory 是 URI） */
const DB_DIR_FS = DB_DIR_URI.startsWith('file://') ? DB_DIR_URI.slice(7) : DB_DIR_URI;
const DB_DIR = DB_DIR_URI;
const TMP_FILE = `${FileSystem.cacheDirectory}iconpack.download`;

const KEY_ACTIVE = 'icons.active_db';
const KEY_META = 'icons.meta';
const KEY_URL = 'icons.manifest_url';
/** 辅助库的当前文件名 / 元信息（items 沿用上面的旧键，保持老用户平滑升级） */
const auxKey = (kind: PackKind, what: 'name' | 'meta') => `pack.${kind}.${what}`;

/**
 * 把用户填的地址规范成 version.json 的直链。
 * 常见输入是 Gitea 的网页地址 `.../src/branch/main/ae`，需要换成 `.../raw/branch/main/ae`；
 * 目录地址补上 `version.json`，已经是 .json 的原样使用。
 */
export function normalizeManifestUrl(input: string): string {
  return normalizeRepoUrl(input, 'version.json') || '';
}

export function isValidManifestUrl(url: string): boolean {
  return isValidHttpUrl(url);
}

/** 三个库：物品（主库）/ 流体 / 源质 */
export type PackKind = 'items' | 'fluids' | 'essentia';
export const PACK_KINDS: PackKind[] = ['items', 'fluids', 'essentia'];

export const PACK_LABEL: Record<PackKind, string> = {
  items: '物品',
  fluids: '流体',
  essentia: '源质',
};

export interface IconPackInfo {
  version: string;
  sha256: string;
  size: number;
  file: string;
  rows?: number;
  keys?: number;
  fluids?: number;
  gzFile?: string;
  gzSize?: number;
}

export interface RemoteManifest {
  schema: number;
  updated: string;
  note?: string;
  /** schema 2：三个库各一段 */
  items?: IconPackInfo;
  fluids?: IconPackInfo;
  essentia?: IconPackInfo;
  /** 老清单（schema 1）里物品库叫 icons；现在当 items 的别名 */
  icons?: IconPackInfo;
}

/** 取某个库在清单里的条目（老清单只有 icons，当 items 用） */
export function packInfo(manifest: RemoteManifest, kind: PackKind): IconPackInfo | null {
  const info = (manifest as any)[kind] as IconPackInfo | undefined;
  if (info?.sha256) return info;
  if (kind === 'items' && manifest.icons?.sha256) return manifest.icons;
  return null;
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

/** 内置包的文件名（没内置就是 null） */
export function builtinName(kind: PackKind): string | null {
  return BUNDLED_PACKS[kind] ? `${kind}.db` : null;
}

/** 当前生效的库文件名；没装过返回 null（items 为 null 表示 App 还没法用） */
export function getActiveName(kind: PackKind): string | null {
  const stored =
    kind === 'items' ? SecureStore.getItem(KEY_ACTIVE) : SecureStore.getItem(auxKey(kind, 'name'));
  if (stored) return stored;
  return builtinName(kind);
}

/** 物品库当前生效的文件名（App.tsx 的 SQLiteProvider 用它）；null = 还没装 */
export function getActiveDb(): string | null {
  return getActiveName('items');
}

/** 辅助库的「版本签名」，用于让 SQLiteProvider 在辅助库变化时重挂 */
export function getAuxSignature(): string {
  return PACK_KINDS.filter((k) => k !== 'items')
    .map((k) => getActiveName(k) ?? '-')
    .join('|');
}

export function getInstalledInfoFor(kind: PackKind): InstalledInfo {
  const dbName = getActiveName(kind);
  if (!dbName) return { version: null, sha256: null, size: null, dbName: '' };
  try {
    const raw =
      kind === 'items' ? SecureStore.getItem(KEY_META) : SecureStore.getItem(auxKey(kind, 'meta'));
    const meta = JSON.parse(raw || 'null');
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

/** 物品库的安装信息（设置页的主显示项） */
export function getInstalledInfo(): InstalledInfo {
  return getInstalledInfoFor('items');
}

// 切换即时生效：App.tsx 订阅这里，改完直接换 SQLiteProvider 的 key
const dbListeners = new Set<() => void>();
/** 装多个库时先别通知，等全部装完再通知一次 —— 否则装到一半就重挂 Provider，
 *  SQLiteProvider 会去开一个还在写文件的库，界面黑屏 */
let notifySuppressed = 0;

export function subscribeActiveDb(fn: () => void): () => void {
  dbListeners.add(fn);
  return () => dbListeners.delete(fn);
}

function setActiveName(
  kind: PackKind,
  name: string | null,
  meta?: { version: string; sha256: string; size: number } | null,
) {
  const builtin = builtinName(kind);
  const nameKey = kind === 'items' ? KEY_ACTIVE : auxKey(kind, 'name');
  const metaKey = kind === 'items' ? KEY_META : auxKey(kind, 'meta');
  if (name && name === builtin) {
    // 写回内置库名而不是删除：SecureStore 没有同步删除接口，删除后紧跟的读取会读到旧值
    SecureStore.setItem(nameKey, builtin);
    SecureStore.deleteItemAsync(metaKey).catch(() => undefined);
  } else if (name) {
    SecureStore.setItem(nameKey, name);
    if (meta) SecureStore.setItem(metaKey, JSON.stringify(meta));
  } else {
    // 没有内置包：清掉记录（读的时候会回落到内置，没有内置就是 null）
    SecureStore.setItem(nameKey, '');
    SecureStore.deleteItemAsync(metaKey).catch(() => undefined);
  }
  if (!notifySuppressed) dbListeners.forEach((fn) => fn());
}

/** 兼容旧调用：切换物品库 */
function setActiveDb(name: string, meta?: { version: string; sha256: string; size: number } | null) {
  setActiveName('items', name, meta);
}

/** 卸载某个库的在线包，回到内置（没有内置就是空） */
export function restoreBuiltin(kind: PackKind = 'items'): void {
  setActiveName(kind, builtinName(kind));
}

/** 三个库全部回到内置 */
export function restoreAllBuiltin(): void {
  for (const kind of PACK_KINDS) setActiveName(kind, builtinName(kind));
}

/**
 * 启动时把内置包落到 SQLite 目录（编译时嵌入了才有），
 * 再确认当前生效的文件都还在，丢了的退回内置。
 * 返回物品库文件名；null 表示这台机器上还没有任何物品库 → App 要进「首次配置」。
 */
export async function resolveActiveDb(): Promise<string | null> {
  await materializeBundledPacks();
  for (const kind of PACK_KINDS) {
    const name = getActiveName(kind);
    if (!name) continue;
    const info = await FileSystem.getInfoAsync(`${DB_DIR}${name}`);
    if (!info.exists) {
      setActiveName(kind, builtinName(kind));
      // 回落到内置库：但内置包可能因为「之前用的是在线包」被跳过了解压，这里补一次
      if (name !== builtinName(kind)) await materializeBundledPacks(kind, true);
    }
  }
  return getActiveDb();
}

/**
 * 把编译期内置的包复制到 SQLite 目录（幂等）。
 *
 * 2026-10-29 修：以前每次启动都无条件 `Asset.downloadAsync()` 一遍内置包 ——
 * 内置物品库 194MB，实测这一句吃掉 **895ms**（整个启动才 1s）。
 * 现在两道短路：
 *   ① 当前用的是在线包 → 内置包根本不会被打开，直接跳过；
 *   ② 落地过的内置包 sha 记在 SecureStore 里，sha 没变且文件在 → 跳过。
 * 只有「首次安装」和「APK 换了内置库」才真的去解压。
 */
async function materializeBundledPacks(only?: PackKind, force = false): Promise<void> {
  if (!PACK_KINDS.some((k) => BUNDLED_PACKS[k])) return;
  try {
    await FileSystem.makeDirectoryAsync(DB_DIR, { intermediates: true });
  } catch {
    // 已存在
  }
  for (const kind of PACK_KINDS) {
    if (only && kind !== only) continue;
    const pack = BUNDLED_PACKS[kind];
    if (!pack) continue;
    const target = `${DB_DIR}${kind}.db`;
    // 键里带 v2：v1 的标记有「按大小跳过复制」的 bug，可能记着一个其实没落地的 sha，
    // 换键名让所有老标记失效，强制重新落地一次
    const markKey = `pack.v2.bundled.${kind}.sha`;
    try {
      if (!force) {
        // ① 用的是在线包，内置包用不上
        const active = getActiveName(kind);
        if (active && active !== builtinName(kind)) continue;
        // ② 同一个内置包已经落地过
        if (SecureStore.getItem(markKey) === pack.sha256) {
          const info = await FileSystem.getInfoAsync(target);
          if (info.exists) continue;
        }
      }
      const asset = Asset.fromModule(pack.asset);
      await asset.downloadAsync();
      const src = asset.localUri;
      if (!src) continue;
      // 走到这里说明「内置包的 sha 和上次落地的不一样」，必须复制。
      // 以前还比了一次文件大小，结果 size 恰好相同的更新被跳过、标记却写成了新的，
      // 设备上就永远留着旧库（2026-10-29 实测：fluids.db 新旧都是 2007040 字节）。
      await FileSystem.copyAsync({ from: src, to: target });
      SecureStore.setItem(markKey, pack.sha256);
    } catch {
      // 复制失败就当没有内置包
    }
  }
}

/** 辅助库实际要挂载的绝对路径（真实路径，不带 file://）；没有就返回 null */
export function auxDbPath(kind: PackKind): string | null {
  const name = getActiveName(kind);
  return name ? `${DB_DIR_FS}${name}` : null;
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
    if (!data?.items?.sha256 && !data?.icons?.sha256) {
      throw new Error('清单格式不对：缺少 items.sha256');
    }
    return data;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('清单请求超时，请检查更新源地址');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 某个库本地生效的 sha256（没装过在线包就用内置包的 sha，两者都没有就是 null） */
function localShaOf(kind: PackKind): string | null {
  const inst = getInstalledInfoFor(kind);
  if (inst.sha256) return inst.sha256;
  return BUNDLED_PACKS[kind]?.sha256 ?? null;
}

/** 清单里哪些库需要更新（逐个比 sha256，不看版本号排序） */
export function pendingKinds(manifest: RemoteManifest): PackKind[] {
  return PACK_KINDS.filter((kind) => {
    const info = packInfo(manifest, kind);
    return !!info && localShaOf(kind) !== info.sha256;
  });
}

/** 清单里有没有任意一个库和本地不一样 */
export function hasUpdate(manifest: RemoteManifest): boolean {
  return pendingKinds(manifest).length > 0;
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

/** 每个库用来校验的「表 + 行数」 */
const VERIFY_TABLE: Record<PackKind, string> = {
  items: 'item_panel',
  fluids: 'fluid_container',
  essentia: 'aspect',
};

export async function downloadAndInstall(
  manifest: RemoteManifest,
  options: DownloadOptions = {},
): Promise<{ dbName: string; version: string; updated: PackKind[] }> {
  const kinds = pendingKinds(manifest);
  const totalBytes = kinds.reduce((n, k) => n + (packInfo(manifest, k)?.size ?? 0), 0) || 1;
  let doneBytes = 0;

  notifySuppressed += 1;
  try {
    for (const kind of kinds) {
      const info = packInfo(manifest, kind)!;
      await installOne(kind, info, (written, total) => {
        options.onProgress?.((doneBytes + written) / totalBytes, doneBytes + written, totalBytes);
      });
      doneBytes += info.size;
    }
  } finally {
    notifySuppressed -= 1;
  }
  // 全部装完再让界面重挂一次
  if (kinds.length) dbListeners.forEach((fn) => fn());

  const installed = getInstalledInfo();
  return { dbName: getActiveDb(), version: installed.version ?? '', updated: kinds };
}

/** 下载并装一个库：下载 → 校验大小 → 校验库内容 → 切换 → 清理旧包 */
async function installOne(
  kind: PackKind,
  info: IconPackInfo,
  onProgress: (written: number, total: number) => void,
): Promise<void> {
  const url = fileUrlFor(getManifestUrl(), info.file);
  const target = `${DB_DIR}${kind}-${info.sha256.slice(0, 12)}.db`;

  await FileSystem.makeDirectoryAsync(DB_DIR, { intermediates: true }).catch(() => undefined);
  await FileSystem.deleteAsync(TMP_FILE, { idempotent: true });

  const resumable = FileSystem.createDownloadResumable(url, TMP_FILE, {}, (p) => {
    const total = p.totalBytesExpectedToWrite || info.size;
    onProgress(p.totalBytesWritten, total);
  });
  const result = await resumable.downloadAsync();
  if (!result?.uri) throw new Error(`下载中断（${PACK_LABEL[kind]}库）`);

  const stat = await FileSystem.getInfoAsync(result.uri);
  const size = stat.exists && !stat.isDirectory ? stat.size : 0;
  if (info.size && size !== info.size) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new Error(`${PACK_LABEL[kind]}库大小不符：${size} != ${info.size}`);
  }

  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: result.uri, to: target });

  const dbName = target.slice(DB_DIR.length);
  try {
    await verifyDatabase(dbName, kind, info.rows ?? 0);
  } catch (e) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw e;
  }

  setActiveName(kind, dbName, { version: info.version, sha256: info.sha256, size: info.size });
  await cleanupOldPacks(PACK_KINDS.map((k) => getActiveName(k)).filter((n): n is string => !!n));
}

/** 打开一遍确认不是坏文件：表结构 + 行数 + SQLite 自检 */
async function verifyDatabase(dbName: string, kind: PackKind, expectRows: number): Promise<void> {
  const table = VERIFY_TABLE[kind];
  const db = await openDatabaseAsync(dbName);
  try {
    const row = await db.getFirstAsync<{ c: number }>(`select count(*) as c from ${table}`);
    const check = await db.getFirstAsync<{ quick_check: string }>('pragma quick_check(1)');
    if (!row || row.c === 0) throw new Error(`${PACK_LABEL[kind]}库为空，已丢弃`);
    if (expectRows && row.c !== expectRows) {
      throw new Error(`${PACK_LABEL[kind]}库行数不符：${row.c} != ${expectRows}`);
    }
    if (check && check.quick_check !== 'ok') {
      throw new Error(`${PACK_LABEL[kind]}库完整性检查失败：${check.quick_check}`);
    }
  } finally {
    await db.closeAsync();
  }
}

/** 在线库文件名形如 items-1a2b3c4d5e6f.db */
const PACK_FILE_RE = /^(items|fluids|essentia)-[0-9a-f]+\.db$/;

/** 删掉不在用的旧库文件（内置库不动） */
async function cleanupOldPacks(keep: string[]): Promise<void> {
  try {
    for (const f of await FileSystem.readDirectoryAsync(DB_DIR)) {
      if (PACK_FILE_RE.test(f) && !keep.includes(f)) {
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
      if (!PACK_FILE_RE.test(f)) continue;
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
  restoreAllBuiltin();
  // 切库后 App 会重挂 SQLiteProvider，等旧连接释放再删文件
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    for (const f of await FileSystem.readDirectoryAsync(DB_DIR)) {
      if (PACK_FILE_RE.test(f)) await FileSystem.deleteAsync(`${DB_DIR}${f}`, { idempotent: true });
    }
  } catch {
    // 删不掉时保留文件，下次启动会按 active_db 忽略它们
  }
  await FileSystem.deleteAsync(TMP_FILE, { idempotent: true }).catch(() => undefined);
}
