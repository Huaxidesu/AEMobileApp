// 多账号（连接预设）：每个账号独立保存协议 / 地址 / 端口 / 密码 / 主网，切换账号即切换服务器。
// 密码存在 SecureStore（单值 2KB 上限），因此一个账号一个 key，索引里只放 id。
import * as SecureStore from 'expo-secure-store';
import { AENetwork, DEFAULT_PORT, ServerConfig } from './api';
import { BUILTIN_SERVERS, entryForHost } from './serverlist';

const KEY_INDEX = 'accounts.index';
const KEY_ACTIVE = 'accounts.active';
const KEY_PREFIX = 'account.';

/** 旧版单配置的 key，只在首次升级时读一次 */
const LEGACY = {
  scheme: 'server.scheme',
  ip: 'server.ip',
  port: 'server.port',
  uuid: 'user.uuid',
  mainnet: 'user.ae_main_net',
} as const;

export interface ServerAccount extends ServerConfig {
  id: string;
  /** 玩家备注名；留空时用线路名或地址兜底 */
  name: string;
  updatedAt: number;
}

function makeId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function readAccount(id: string): ServerAccount | null {
  try {
    const raw = SecureStore.getItem(KEY_PREFIX + id);
    if (!raw) return null;
    const acc = JSON.parse(raw) as ServerAccount & { uuid?: string };
    if (!acc?.id) return null;
    // 2.1.0 之前字段叫 uuid（存的是玩家 UUID 首段），现在存 token。
    // 老记录直接搬过来：值本来就不对（服务端已改随机 token），用户重新粘贴一次即可。
    if (!acc.token && acc.uuid) acc.token = acc.uuid;
    if (!acc.token) acc.token = '';
    delete (acc as any).uuid;
    return acc;
  } catch {
    return null;
  }
}

function writeAccount(acc: ServerAccount): void {
  SecureStore.setItem(KEY_PREFIX + acc.id, JSON.stringify({ ...acc, updatedAt: Date.now() }));
}

function readIndex(): string[] {
  try {
    const raw = SecureStore.getItem(KEY_INDEX);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]): void {
  SecureStore.setItem(KEY_INDEX, JSON.stringify(ids));
}

function parseMainnet(raw: string | null): AENetwork | null {
  try {
    return JSON.parse(raw ?? 'null');
  } catch {
    return null;
  }
}

/**
 * 默认线路：内置列表现在默认是空的（线路由服主的配置包/在线列表给），
 * 所以这里不能直接取 `BUILTIN_SERVERS[0].host` —— 空数组时 undefined.host 会抛 TypeError。
 */
function defaultLine(): { host: string; port: string } {
  const line = BUILTIN_SERVERS[0];
  return { host: line?.host ?? '', port: line?.port ?? DEFAULT_PORT };
}

/** 默认账号：优先沿用旧版单配置，没有就指向默认线路（密码留空等玩家填） */
function seedAccount(): ServerAccount {
  const legacyIp = SecureStore.getItem(LEGACY.ip) ?? '';
  const line = defaultLine();
  return {
    id: makeId(),
    name: '',
    scheme: 'tcp',
    ip: legacyIp || line.host,
    port: SecureStore.getItem(LEGACY.port) ?? line.port,
    token: SecureStore.getItem(LEGACY.uuid) ?? '',
    mainnet: parseMainnet(SecureStore.getItem(LEGACY.mainnet)),
    updatedAt: Date.now(),
  };
}

/** 读取全部账号；索引为空（首次运行或数据损坏）时建一个默认账号 */
export function loadAccounts(): ServerAccount[] {
  const ids = readIndex();
  const list = ids.map(readAccount).filter((a): a is ServerAccount => a !== null);
  if (list.length > 0) return list;

  const seeded = seedAccount();
  writeAccount(seeded);
  writeIndex([seeded.id]);
  setActiveAccountId(seeded.id);
  return [seeded];
}

export function getActiveAccountId(): string {
  const accounts = loadAccounts();
  const stored = SecureStore.getItem(KEY_ACTIVE);
  if (stored && accounts.some((a) => a.id === stored)) return stored;
  setActiveAccountId(accounts[0].id);
  return accounts[0].id;
}

export function setActiveAccountId(id: string): void {
  SecureStore.setItem(KEY_ACTIVE, id);
}

export function getActiveAccount(): ServerAccount {
  const accounts = loadAccounts();
  const id = getActiveAccountId();
  return accounts.find((a) => a.id === id) ?? accounts[0];
}

/** 当前账号对应的连接配置（其余屏幕只认这个） */
export function loadActiveConfig(): ServerConfig {
  const { scheme, ip, port, token, mainnet } = getActiveAccount();
  return { scheme, ip, port, token, mainnet };
}

/** 写入账号；不在索引里就补进去 */
export function upsertAccount(acc: ServerAccount): ServerAccount {
  const next = { ...acc, updatedAt: Date.now() };
  writeAccount(next);
  const ids = readIndex();
  if (!ids.includes(next.id)) writeIndex([...ids, next.id]);
  return next;
}

export function createAccount(patch: Partial<ServerAccount> = {}): ServerAccount {
  const line = defaultLine();
  const acc: ServerAccount = {
    id: makeId(),
    name: '',
    scheme: 'tcp',
    ip: line.host,
    port: line.port,
    token: '',
    mainnet: null,
    updatedAt: Date.now(),
    ...patch,
  };
  return upsertAccount(acc);
}

/** 删除账号；删的是当前账号就切到第一个，删光了就再建一个空账号 */
export function deleteAccount(id: string): void {
  // 必须在改索引之前判断，否则 getActiveAccountId 已经回退到第一个了
  const wasActive = getActiveAccountId() === id;
  const ids = readIndex().filter((v) => v !== id);
  writeIndex(ids);
  SecureStore.deleteItemAsync(KEY_PREFIX + id).catch(() => undefined);

  if (ids.length === 0) {
    const fresh = createAccount();
    setActiveAccountId(fresh.id);
    return;
  }
  if (wasActive) setActiveAccountId(ids[0]);
}

/** 列表里显示的名字：备注名 → 线路名 → 地址 */
export function accountLabel(acc: ServerAccount): string {
  if (acc.name.trim()) return acc.name.trim();
  const line = entryForHost(acc.ip, acc.port);
  if (line) return line.name;
  return acc.ip || '未命名账号';
}

/** 副标题：地址 + 主网状态 */
export function accountSummary(acc: ServerAccount): string {
  const addr = acc.ip ? `${acc.ip}:${acc.port}` : '未填地址';
  if (!acc.mainnet) return `${addr} · 未选主网`;
  return `${addr} · DIM ${acc.mainnet.dimid}`;
}
