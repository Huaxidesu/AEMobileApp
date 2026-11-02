// App 自身的更新检查：拉 GitHub Release 的最新一条，比对版本号。
//
// 为什么不用图标库那套自建更新源：APK 要**签名一致**才能覆盖安装，GitHub Release 是现成的
// 大文件分发 + 版本标记，CI 打完包直接挂上去就行，不用再维护一份清单。
//
// 只读公开 API，不需要 token；未认证请求按 IP 限流 60 次/小时，手动点「检查更新」够用。
import { APP_VERSION, REPO_APP } from './appinfo';

export type AppUpdate = {
  /** 最新版本号，已去掉 tag 的 `v` 前缀 */
  version: string;
  /** Release 页面地址（没有 apk 附件时给用户手动去下） */
  page: string;
  /** APK 直链；Release 里没挂 apk 时为 null */
  apk: string | null;
  /** 更新说明（Release 正文，可能为空） */
  notes: string;
  /** APK 字节数，0 表示未知 */
  size: number;
};

const API = REPO_APP.replace('https://github.com/', 'https://api.github.com/repos/') + '/releases/latest';

/** `3.4.10` 要排在 `3.4.9` 后面，所以按数字逐段比，不能直接字符串比较 */
function parseVer(v: string): number[] {
  return String(v)
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((s) => parseInt(s, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

/** a 比 b 新返回 true */
export function isNewer(a: string, b: string): boolean {
  const x = parseVer(a);
  const y = parseVer(b);
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p !== q) return p > q;
  }
  return false;
}

/**
 * 查最新版本。已经是最新（或仓库还没有 Release）时返回 null。
 *
 * 网络错误会抛出去，由调用方提示 —— 别在这里吞掉，否则「检查更新失败」会被当成「已是最新」。
 */
export async function checkAppUpdate(current: string = APP_VERSION): Promise<AppUpdate | null> {
  const resp = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
  if (resp.status === 404) return null; // 还没发过 Release
  if (!resp.ok) throw new Error(`GitHub ${resp.status}`);

  const rel = (await resp.json()) as {
    tag_name?: string;
    html_url?: string;
    body?: string;
    assets?: { name?: string; browser_download_url?: string; size?: number }[];
  };
  const tag = (rel.tag_name ?? '').replace(/^v/i, '');
  if (!tag || !isNewer(tag, current)) return null;

  const apk = (rel.assets ?? []).find((a) => (a.name ?? '').toLowerCase().endsWith('.apk'));
  return {
    version: tag,
    page: rel.html_url ?? REPO_APP + '/releases',
    apk: apk?.browser_download_url ?? null,
    notes: (rel.body ?? '').trim(),
    size: apk?.size ?? 0,
  };
}
