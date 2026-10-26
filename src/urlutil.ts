// 在线数据地址的小工具：Gitea 网页地址 → raw 直链、目录补文件名、合法性校验

/**
 * 把用户填的地址规范成某个数据文件的直链。
 * 常见输入是 Gitea 的网页地址 `.../src/branch/main/ae`，需要换成 `.../raw/branch/main/ae`；
 * 目录地址补上文件名，已经是 .json 的原样使用。
 */
export function normalizeRepoUrl(input: string, fileName: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!url) return '';
  url = url.replace('/src/branch/', '/raw/branch/');
  if (!/\.json$/i.test(url)) url = `${url}/${fileName}`;
  return url;
}

export function isValidHttpUrl(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url.trim());
}

/** 显示用：去掉协议前缀，省点横向空间 */
export function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** 显示用：只留域名和文件名，长路径不占满一行 */
export function shortUrlLabel(url: string): string {
  const m = /^https?:\/\/([^/]+)\/(.*)$/i.exec(url);
  if (!m) return url;
  const file = m[2].split('/').filter(Boolean).pop() ?? '';
  return file ? `${m[1]} · ${file}` : m[1];
}
