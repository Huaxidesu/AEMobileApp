// 辅助库（流体 / 源质）的装配
//
// 三个库都是「在线包 or 编译期内置」，没有随 APK 写死的默认库。
// 这里只负责：把 fluids.db / essentia.db 用 SQLite 的 ATTACH 挂到主连接上
// （不额外开连接、不额外占内存），查询写成 `fluids.xxx` / `essentia.xxx`。
import * as FileSystem from 'expo-file-system';
import { SQLiteDatabase } from 'expo-sqlite';
import { auxDbPath, builtinName, getActiveName, type PackKind } from './iconpack';

/** 需要挂载的辅助库（schema 名 = 文件名） */
export const AUX_DBS = ['fluids', 'essentia'] as const;
export type AuxDb = (typeof AUX_DBS)[number];

/** 挂到主连接上（幂等；SQLiteProvider 的 onInit 里调用）。没有这个库就跳过。 */
export async function attachAux(db: SQLiteDatabase): Promise<void> {
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

/** 辅助库有没有在线包（供设置页显示） */
export function auxIsOnline(kind: PackKind): boolean {
  const active = getActiveName(kind);
  const builtin = builtinName(kind);
  return !!active && active !== builtin;
}
