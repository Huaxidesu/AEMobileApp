// 服务端配置与接口层。SecureStore key 与旧版保持一致，老用户升级不丢配置。
import * as SecureStore from 'expo-secure-store';

export interface AENetwork {
  dimid: number;
  x: number;
  y: number;
  z: number;
}

export interface ServerConfig {
  scheme: string;
  ip: string;
  port: string;
  uuid: string;
  mainnet: AENetwork | null;
}

export interface ApiResponse<T> {
  succeed: boolean;
  body: T;
  message?: string;
}

export const DEFAULT_PORT = '44444';

export async function loadConfig(): Promise<ServerConfig> {
  let mainnet: AENetwork | null = null;
  try {
    mainnet = JSON.parse(SecureStore.getItem('user.ae_main_net') ?? 'null');
  } catch {
    mainnet = null;
  }
  return {
    scheme: SecureStore.getItem('server.scheme') ?? 'http',
    ip: SecureStore.getItem('server.ip') ?? '',
    port: SecureStore.getItem('server.port') ?? DEFAULT_PORT,
    uuid: SecureStore.getItem('user.uuid') ?? '',
    mainnet,
  };
}

export async function saveConfig(cfg: ServerConfig): Promise<void> {
  SecureStore.setItem('server.scheme', cfg.scheme);
  SecureStore.setItem('server.ip', cfg.ip);
  SecureStore.setItem('server.port', cfg.port);
  SecureStore.setItem('user.uuid', cfg.uuid);
  if (cfg.mainnet) {
    SecureStore.setItem('user.ae_main_net', JSON.stringify(cfg.mainnet));
  }
}

export function isConfigComplete(cfg: ServerConfig): boolean {
  return !!(cfg.ip && cfg.scheme && cfg.uuid && cfg.mainnet && cfg.mainnet.x != null);
}

export function baseUrl(cfg: ServerConfig): string {
  return `${cfg.scheme}://${cfg.ip}:${cfg.port}`;
}

export function apiUrl(cfg: ServerConfig, path: string, params: Record<string, string | number | boolean | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${baseUrl(cfg)}${path}${qs ? `?${qs}` : ''}`;
}

export async function getJson<T>(cfg: ServerConfig, path: string, params?: Record<string, string | number | boolean | undefined>): Promise<ApiResponse<T>> {
  const resp = await fetch(apiUrl(cfg, path, params));
  return (await resp.json()) as ApiResponse<T>;
}

export async function postForm<T>(cfg: ServerConfig, path: string, params: Record<string, string | number | boolean | undefined>): Promise<ApiResponse<T>> {
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ''))}`)
    .join('&');
  const resp = await fetch(apiUrl(cfg, path, {}), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  return (await resp.json()) as ApiResponse<T>;
}

export function openSSE(cfg: ServerConfig, path: string, params: Record<string, string | number | boolean | undefined>, postBody?: Record<string, string | number | boolean | undefined>) {
  // 按需动态引入，避免把 SSE 类型扩散到每个文件
  const EventSource = require('react-native-sse').default;
  const es = new EventSource(apiUrl(cfg, path, params), postBody
    ? {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: Object.entries(postBody)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ''))}`)
          .join('&'),
      }
    : undefined);
  return es;
}

// 测试连接：先 http 后 https，返回可用的 scheme，失败返回 null
export async function testConnection(ip: string, port: string): Promise<string | null> {
  for (const scheme of ['http', 'https']) {
    try {
      const resp = await fetch(`${scheme}://${ip}:${port}/AEMobileTest`, { method: 'GET' });
      // mod 侧该端点返回 200；404 也说明端口通（旧版 mod），视作可用
      if (resp.status === 200 || resp.status === 404) return scheme;
    } catch {
      // 尝试下一种 scheme
    }
  }
  return null;
}

// 服务端数字格式化（与旧版一致：1024 进制 K/M/G/T）
export function formatItemCount(itemCount: number): string {
  if (itemCount < 10000) return itemCount.toString();
  if (itemCount < 1000000) return (itemCount / 1024).toPrecision(3) + 'K';
  if (itemCount < 1000000000) return (itemCount / 1048576).toPrecision(3) + 'M';
  if (itemCount < 1000000000000) return (itemCount / 1073741824).toPrecision(3) + 'G';
  return (itemCount / 1099511627776).toPrecision(3) + 'T';
}

// ---- 协议类型 ----
export interface ItemStackResp {
  item_name: string;
  meta: number;
  count: number;
  craftable: boolean;
  nbt?: string;
}

export interface CraftingCPUInfo {
  idx: number;
  cpuName: string;
  storage: number;
  parallelism: number;
  item: string | null;
  remainingCount: number;
  meta: number;
  nbt?: string | null;
}

export interface CraftTaskItem {
  name: string;
  meta: number;
  nbt?: string | null;
  crafting: boolean;
  numberPresent: number;
  numberSent: number;
  numberRemainingToCraft: number;
  missing: number;
  // 客户端填充
  dname?: string | null;
  icon?: string | null;
  nbtobj?: any;
  original_name?: string;
  original_meta?: number;
}

export interface CraftPlan {
  plan: CraftTaskItem[];
  bytesUsed: number;
}
