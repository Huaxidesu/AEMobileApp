// 聊天本地缓存（7 天）。服务端不存任何历史，这边是唯一的落盘副本。
//
// 为什么单独开一个库而不是塞进物品库：物品库是 189MB 的只读图标库（在线更新会整包替换），
// 往里写东西会跟着换包一起丢。聊天是独立的 append-only 小库，几十万行也就几 MB。
//
// 主键是 (scope, boot, seq)：boot 是服务端那次启动的时间戳，服务端重启后 seq 会归零，
// 不带 boot 的话新一轮的 seq=1 会和上一轮的 seq=1 撞车。
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'aemobile-chat.db';
/** 只留 7 天 */
export const RETENTION_MS = 7 * 24 * 3600 * 1000;
/** 一次最多读这么多条进内存（再多也没人往下翻） */
const LOAD_LIMIT = 600;

export interface StoredMsg {
  scope: string;
  boot: number;
  seq: number;
  ts: number;
  /** 0 = 游戏内玩家，1 = 手机 App */
  kind: number;
  name: string;
  text: string;
}

let db: SQLite.SQLiteDatabase | null = null;
let purgeAt = 0;

function open(): SQLite.SQLiteDatabase {
  if (db) return db;
  const d = SQLite.openDatabaseSync(DB_NAME);
  d.execSync(
    `PRAGMA journal_mode = WAL;
     CREATE TABLE IF NOT EXISTS msg (
       scope TEXT NOT NULL,
       boot  INTEGER NOT NULL,
       seq   INTEGER NOT NULL,
       ts    INTEGER NOT NULL,
       kind  INTEGER NOT NULL,
       name  TEXT NOT NULL,
       text  TEXT NOT NULL,
       PRIMARY KEY (scope, boot, seq)
     );
     CREATE INDEX IF NOT EXISTS idx_msg_ts ON msg (scope, ts);`,
  );
  db = d;
  return d;
}

/** 清掉超过 7 天的；每 10 分钟最多跑一次，避免每条消息都全表扫 */
export function purgeExpired(now = Date.now()): void {
  if (now - purgeAt < 10 * 60 * 1000) return;
  purgeAt = now;
  try {
    open().runSync('DELETE FROM msg WHERE ts < ?', now - RETENTION_MS);
  } catch (e) {
    console.warn('[chat] purge failed', e);
  }
}

/** 读最近的消息（时间升序）。开机/切服时调一次。 */
export function loadRecent(scope: string): StoredMsg[] {
  try {
    purgeExpired();
    const rows = open().getAllSync<StoredMsg>(
      `SELECT scope, boot, seq, ts, kind, name, text
         FROM msg WHERE scope = ? AND ts >= ?
        ORDER BY ts DESC, seq DESC LIMIT ?`,
      scope,
      Date.now() - RETENTION_MS,
      LOAD_LIMIT,
    );
    return rows.reverse();
  } catch (e) {
    console.warn('[chat] load failed', e);
    return [];
  }
}

/** 批量写（一帧可能有几十条）。重复的 (scope,boot,seq) 直接忽略，重连补发不会写两遍。 */
export function appendAll(rows: StoredMsg[]): void {
  if (rows.length === 0) return;
  try {
    const d = open();
    d.withTransactionSync(() => {
      for (const r of rows) {
        d.runSync(
          `INSERT OR IGNORE INTO msg (scope, boot, seq, ts, kind, name, text)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          r.scope,
          r.boot,
          r.seq,
          r.ts,
          r.kind,
          r.name,
          r.text,
        );
      }
    });
  } catch (e) {
    console.warn('[chat] append failed', e);
  }
}

/** 清空某个服务器的聊天记录（设置页用） */
export function clearScope(scope: string): void {
  try {
    open().runSync('DELETE FROM msg WHERE scope = ?', scope);
  } catch (e) {
    console.warn('[chat] clear failed', e);
  }
}
