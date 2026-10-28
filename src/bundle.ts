// 配置包（zip）导入：一键把「默认服务器 / 服务器列表 / 图标源」写进 App
//
// 包结构（由 tools/make_bundle.py 生成）：
//   config.json    { "name": "服名", "ip": "mc.example.com", "port": "44444", "token": "", "iconSource": "https://.../ae/version.json", "serverList": "https://.../ae/servers.json" }
//   servers.json   [ { "host": "...", "port": "44444", "name": "...", "tag": "..." } ]
//   README.txt     给玩家的说明（可选）
//
// 图标库本身不放进 zip（太大，而且是模组艺术作品）：config 里的 iconSource 指向更新源，
// 导入后 App 自己去「检查更新」下载。
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import JSZip from 'jszip';
import { createAccount, loadAccounts, setActiveAccountId, upsertAccount } from './accounts';
import { setManifestUrl } from './iconpack';
import { setServerListUrl } from './serverlist';

export interface BundleConfig {
  name?: string;
  ip?: string;
  port?: string;
  token?: string;
  /** 图标库更新源（version.json 直链） */
  iconSource?: string;
  /** 服务器列表更新源（servers.json 直链） */
  serverList?: string;
}

export interface BundleResult {
  config: BundleConfig;
  servers: number;
  iconSourceApplied: boolean;
  serverListApplied: boolean;
}

/** 让用户选一个 zip，解析并应用里面的配置 */
export async function importBundleFromPicker(): Promise<BundleResult | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.length) return null;
  return applyBundleFromFile(picked.assets[0].uri);
}

/** 解析并应用指定路径的 zip */
export async function applyBundleFromFile(uri: string): Promise<BundleResult> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const zip = await JSZip.loadAsync(base64, { base64: true });

  const readText = async (name: string): Promise<string | null> => {
    const f = zip.file(name) ?? zip.file(`aemobile/${name}`);
    return f ? f.async('string') : null;
  };

  const configRaw = await readText('config.json');
  if (!configRaw) throw new Error('压缩包里没有 config.json，不是有效的配置包');
  let config: BundleConfig;
  try {
    config = JSON.parse(configRaw) as BundleConfig;
  } catch {
    throw new Error('config.json 格式不对（不是合法 JSON）');
  }

  const result: BundleResult = { config, servers: 0, iconSourceApplied: false, serverListApplied: false };

  // 1) 默认服务器：有 ip 就建/更新一个账号并切过去
  if (config.ip) {
    const acc = createAccount({
      name: config.name || config.ip,
      ip: config.ip,
      port: config.port || '44444',
      token: config.token || '',
    } as any);
    setActiveAccountId((acc as any).id);
    result.servers += 1;
  }

  // 2) 服务器列表
  const serversRaw = await readText('servers.json');
  if (serversRaw) {
    try {
      const list = JSON.parse(serversRaw) as Array<{ host: string; port?: string; name?: string; tag?: string }>;
      if (Array.isArray(list)) {
        const existing = loadAccounts();
        for (const s of list) {
          if (!s?.host) continue;
          const dup = existing.find((a) => a.ip === s.host && (a.port || '44444') === (s.port || '44444'));
          if (dup) continue;
          upsertAccount(
            createAccount({
              name: s.name || s.host,
              ip: s.host,
              port: s.port || '44444',
              token: '',
            } as any),
          );
          result.servers += 1;
        }
      }
    } catch {
      // 列表坏了不影响主配置
    }
  }

  // 3) 图标源 / 服务器列表源
  if (config.iconSource) {
    setManifestUrl(config.iconSource);
    result.iconSourceApplied = true;
  }
  if (config.serverList) {
    setServerListUrl(config.serverList);
    result.serverListApplied = true;
  }

  return result;
}
