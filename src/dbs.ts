// 辅助库（流体 / 源质）的装配
//
// 三个库都是「在线包 or 编译期内置」，没有随 APK 写死的默认库。
// 这里只负责：把 fluids.db / essentia.db 用 SQLite 的 ATTACH 挂到主连接上
// （不额外开连接、不额外占内存），查询写成 `fluids.xxx` / `essentia.xxx`。
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { SQLiteDatabase } from 'expo-sqlite';
import { auxDbPath, builtinName, getActiveName, type PackKind } from './iconpack';

/** 需要挂载的辅助库（schema 名 = 文件名） */
export const AUX_DBS = ['fluids', 'essentia'] as const;
export type AuxDb = (typeof AUX_DBS)[number];

/** 挂到主连接上（幂等；SQLiteProvider 的 onInit 里调用）。没有这个库就跳过。 */
export async function attachAux(db: SQLiteDatabase): Promise<void> {
  // 物品库有 194MB，默认页缓存只有 2MB：按 (item_name,item_meta) 随机查图标/名字时
  // 每次都可能真的去读磁盘（实测「搜索取名字」428ms）。
  // 索引只有几 MB，给 8MB 页缓存就能常驻。
  //
  // 注意：**不要**开 mmap_size。试过 64MB，实测 RSS 直接多出 70MB（Other mmap 全是脏页），
  // 换来的收益还不如页缓存 + 覆盖索引，低端机上会更容易被 LMK 干掉。
  try {
    await db.execAsync('PRAGMA cache_size = -8000');
  } catch {
    // 不支持就算了，只是慢一点
  }
  for (const name of AUX_DBS) {
    const path = auxDbPath(name as PackKind);
    if (!path) continue;
    try {
      // 注意：ATTACH 要的是裸路径，但 FileSystem 只认 file:// URI。
      // 之前这里直接拿裸路径调 getInfoAsync，永远 exists=false，辅助库其实一次都没挂上。
      const uri = path.startsWith('file://') ? path : `file://${path}`;
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) {
        console.warn('[AEMobile][attach-missing]', name, uri);
        continue;
      }
      await db.execAsync(`ATTACH DATABASE '${path}' AS ${name}`);
    } catch (e) {
      // 已经挂过，或文件坏了：查询会走兜底（图标空白、名字用服务端给的英文名）
      console.warn('[AEMobile][attach-fail]', name, path, String(e));
    }
  }
}

/**
 * 确保 `(item_name, item_meta, dname)` 覆盖索引存在。
 *
 * 为什么需要：`dname` 和 3KB 的图标 BLOB 存在同一行，按名字查显示名时
 * 每次都要读一整行（194MB 库里就是随机读盘），实测取 6000 个名字要 428ms。
 * 有了覆盖索引，这条查询只走索引页（约 3.4MB，能常驻页缓存），同一操作降到几十毫秒。
 *
 * 只跑一次：用「库文件名」做标记，换了图标库会重新建。
 * 建索引本身在 194MB 库上约 1–2 秒，所以调用方要延后到启动完成之后再做。
 */
export async function ensureNameIndex(db: SQLiteDatabase, dbName: string): Promise<void> {
  const markKey = `idx.dname.${dbName}`;
  if (SecureStore.getItem(markKey) === '1') return;
  try {
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_item_dname ON item_panel(item_name, item_meta, dname)');
    SecureStore.setItem(markKey, '1');
    console.log('[AEMobile][idx] item_panel 覆盖索引已就绪', dbName);
  } catch (e) {
    // 建不了就退回「读整行」的老路径，只是慢一点
    console.warn('[AEMobile][idx-fail]', dbName, String(e));
  }
}

/** 辅助库有没有在线包（供设置页显示） */export function auxIsOnline(kind: PackKind): boolean {
  const active = getActiveName(kind);
  const builtin = builtinName(kind);
  return !!active && active !== builtin;
}
