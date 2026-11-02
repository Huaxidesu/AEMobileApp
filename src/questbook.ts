// 在线任务书（gtnhquestsbook.top）的深链拼接。纯函数，可单测。
//
// 站点只认一个查询参数：`?id=<任务 id>` —— bundle.js 里的 `checkHasQuestIdInParameters()`
// 读完 `id` 就去 `questIdToQuest` 表里查，查到直接弹任务详情弹层（章节跟着默认选中的走）。
//
// 任务 id 是 BetterQuesting 自己的「16 字节 UUID → base64url」编码，**带 `==` 填充（24 字符）**。
// 站点的键就是 quest_json.json 里 `quest_id` 的原文，填充少一个字符都查不到。
//
// 服务端（AEMobile 的 ChatRich）抓分享标记用的正则不认 `=`，发到手机上的只有 22 位，
// 所以这里统一补齐 —— App 不依赖服务端版本，老 jar 也能用。

/** 站点根地址；任务详情靠查询参数，没有路径路由 */
export const QUEST_BOOK_HOME = 'https://gtnhquestsbook.top/';

/** BQ 把玩家输入整句换成这个标记，后面跟 24 位 id */
const MARKER = 'betterquesting.msg.sharequest:';

/**
 * 规范化任务 ID：去掉标记前缀、多余的字符，补齐 base64 填充。
 *
 * 认不出来就返回空串（调用方据此只显示「复制原始 ID」，不拼链接）。
 */
export function normQuestId(raw?: string | null): string {
  if (!raw) return '';
  let s = raw.trim();
  const at = s.indexOf(MARKER);
  if (at >= 0) s = s.slice(at + MARKER.length);
  // 有人会把整句 `任务 <id> 看下` 连文字一起粘过来：只挑中间那段 base64
  const m = /[A-Za-z0-9_\-+/]{16,32}={0,2}/.exec(s);
  if (!m) return '';
  // BQ 用 URL-safe 编码；其他来源可能给标准 base64，统一成 url-safe
  s = m[0].replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(s)) return '';
  // 16 字节 → 24 字符（22 位正文 + `==`）；只补不截，长度本来不是 22 的不动
  if (s.length === 22 || s.length === 23) s += '='.repeat(24 - s.length);
  return s;
}

/** 任务详情深链；ID 认不出来返回 null（不拼一个打不开的地址） */
export function questBookUrl(id?: string | null): string | null {
  const q = normQuestId(id);
  return q ? `${QUEST_BOOK_HOME}?id=${encodeURIComponent(q)}` : null;
}

/**
 * 发到聊天里给玩家看的文案：任务名 + 链接。
 * 游戏内 1.7.10 的公屏不会把链接变成可点，但能复制；App 之间的气泡同一条文本。
 */
export function questShareText(name: string | undefined, id?: string | null): string {
  const url = questBookUrl(id);
  const title = (name ?? '').trim();
  if (!url) return title;
  return title ? `${title} ${url}` : url;
}
