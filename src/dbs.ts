// 三个图标库的装配：items.db（主库，SQLiteProvider 管）+ fluids.db / essentia.db（辅助库）
//
// 为什么要分开：物品库 186MB、改动频繁；流体 216KB、源质 180KB，几个月才变一次。
// 分开放进更新仓库后，可以只重发变的那一个。
//
// 辅助库用 SQLite 的 ATTACH 挂到**同一个连接**上，不额外开连接、不额外占内存，
// 查询写成 `fluids.fluid_container` / `essentia.aspect` 就行。
import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
import { SQLiteDatabase } from 'expo-sqlite';

// ATTACH 要的是真实路径，不能带 file:// 前缀（FileSystem.documentDirectory 是 URI）
const DB_DIR_URI = `${FileSystem.documentDirectory}SQLite/`;
const DB_DIR = DB_DIR_URI.startsWith('file://') ? DB_DIR_URI.slice(7) : DB_DIR_URI;

/** 需要挂载的辅助库（schema 名 = 文件名） */
export const AUX_DBS = ['fluids', 'essentia'] as const;
export type AuxDb = (typeof AUX_DBS)[number];

const MODULES: Record<AuxDb, number> = {
  fluids: require('../assets/fluids.db'),
  essentia: require('../assets/essentia.db'),
};

/**
 * 把 assets 里的辅助库复制到 SQLite 目录。
 * 按文件大小判断是否已经是同一个版本（这两个库很小，不值得为它们再算 sha256）。
 */
async function copyIfChanged(name: AuxDb): Promise<void> {
  const target = `${DB_DIR_URI}${name}.db`;
  const asset = Asset.fromModule(MODULES[name]);
  await asset.downloadAsync();
  const src = asset.localUri;
  if (!src) return;
  const srcInfo = await FileSystem.getInfoAsync(src);
  const dstInfo = await FileSystem.getInfoAsync(target);
  // 两个库加起来不到 400KB，每次启动直接覆盖，省得纠结版本比对
  if (dstInfo.exists && srcInfo.exists && dstInfo.size === srcInfo.size) {
    await FileSystem.deleteAsync(target, { idempotent: true });
  }
  await FileSystem.copyAsync({ from: src, to: target });
}

/** App 启动时调用一次：保证两个辅助库文件就位（在打开主库之前） */
export async function ensureAuxDbs(): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(DB_DIR_URI, { intermediates: true });
  } catch {
    // 已存在
  }
  for (const name of AUX_DBS) {
    try {
      await copyIfChanged(name);
    } catch {
      // 复制失败不阻塞启动
    }
  }
}

/** 挂到主连接上（幂等；SQLiteProvider 的 onInit 里调用） */
export async function attachAux(db: SQLiteDatabase): Promise<void> {
  for (const name of AUX_DBS) {
    try {
      await db.execAsync(`ATTACH DATABASE '${DB_DIR}${name}.db' AS ${name}`);
    } catch {
      // 已经挂过，或文件缺失（查询会走兜底：图标空白、名字用服务端给的英文名）
    }
  }
}
