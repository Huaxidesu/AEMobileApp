// 聊天本地缓存（7 天）。服务端不存任何历史，这边是唯一的落盘副本。
//
// 为什么单独建一个库而不写入物品库：物品库是 189MB 的只读图标库（在线更新会整包替换），
// 向其中写入的数据会随换包一起丢失。聊天是独立的 append-only 小库，几十万行也就几 MB。
//
// 主键是 (scope, boot, seq)：boot 是服务端那次启动的时间戳，服务端重启后 seq 会归零，
// 不带 boot 的话新一轮的 seq=1 会与上一轮的 seq=1 产生冲突。
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
  /** 0 = 游戏内玩家，1 = 手机 App，2 = 加入，3 = 退出，4 = 服务器广播，5 = AllMusic */
  kind: number;
  name: string;
  text: string;
  /** 来源服务器显示名；空串表示本服（群组服里才有值） */
  srv?: string;
  /** 结构化附件的 JSON 数组字符串；空串表示没有 */
  att?: string;
  /** 玩家所在队伍名（ServerUtilities）；空串表示没有队伍 */
  team?: string;
  /** 队伍颜色码字符（MC 的 `d` / `b` …）；空串表示没有队伍或旧服务端 */
  teamColor?: string;
  /** 玩家所在世界的显示名；空串表示不知道（服务器广播、App 消息、旧服务端都没有） */
  world?: string;
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
       srv   TEXT NOT NULL DEFAULT '',
       att   TEXT NOT NULL DEFAULT '',
       team  TEXT NOT NULL DEFAULT '',
       team_color TEXT NOT NULL DEFAULT '',
       world TEXT NOT NULL DEFAULT '',
       PRIMARY KEY (scope, boot, seq)
     );
     CREATE INDEX IF NOT EXISTS idx_msg_ts ON msg (scope, ts);`,
  );
  migrate(d);
  db = d;
  return d;
}

/**
 * 旧库升级：`CREATE TABLE IF NOT EXISTS` 不会给已有的表补列。
 * 3.4.0 之前的库只有 7 列，这里按需补 `srv` / `att` / `team` / `team_color` / `world`，
 * 已有的行默认为空串。
 */
function migrate(d: SQLite.SQLiteDatabase): void {
  try {
    const cols = d.getAllSync<{ name: string }>('PRAGMA table_info(msg)');
    const has = (n: string) => cols.some((c) => c.name === n);
    if (!has('srv')) d.execSync("ALTER TABLE msg ADD COLUMN srv TEXT NOT NULL DEFAULT ''");
    if (!has('att')) d.execSync("ALTER TABLE msg ADD COLUMN att TEXT NOT NULL DEFAULT ''");
    if (!has('team')) d.execSync("ALTER TABLE msg ADD COLUMN team TEXT NOT NULL DEFAULT ''");
    if (!has('team_color')) d.execSync("ALTER TABLE msg ADD COLUMN team_color TEXT NOT NULL DEFAULT ''");
    if (!has('world')) d.execSync("ALTER TABLE msg ADD COLUMN world TEXT NOT NULL DEFAULT ''");
  } catch (e) {
    console.warn('[chat] migrate failed', e);
  }
}

/** 清理超过 7 天的数据；每 10 分钟最多执行一次，避免每条消息都触发全表扫描 */
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
      `SELECT scope, boot, seq, ts, kind, name, text, srv, att, team, team_color AS teamColor, world
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
          `INSERT OR IGNORE INTO msg (scope, boot, seq, ts, kind, name, text, srv, att, team, team_color, world)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.scope,
          r.boot,
          r.seq,
          r.ts,
          r.kind,
          r.name,
          r.text,
          r.srv ?? '',
          r.att ?? '',
          r.team ?? '',
          r.teamColor ?? '',
          r.world ?? '',
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
