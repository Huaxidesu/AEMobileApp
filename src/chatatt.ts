// 聊天附件的解析（纯函数，不依赖 React Native，可单测）。
//
// 服务端在 `att` 字段里给的是 JSON 数组（见 AEMobile 的 net/ChatRich）：
//   [{ "t": "item", "n": "钢锭", "h": "GT 钢锭\n耐久 3/3" }]
//   [{ "t": "quest", "i": "0123456789abcdef" }]

export interface ChatAtt {
  /** item = 物品链接，quest = 任务分享 */
  t: 'item' | 'quest';
  /** 物品名 */
  n?: string;
  /** 悬停提示，多行用 \n 分隔 */
  h?: string;
  /** 任务 ID */
  i?: string;
}

/** 解析服务端给的附件 JSON；格式不对时返回空数组，不影响正文 */
export function parseAtt(raw?: string): ChatAtt[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is ChatAtt => !!x && (x.t === 'item' || x.t === 'quest'));
  } catch {
    return [];
  }
}

/** 附件在界面上的一行标题 */
export function attLabel(att: ChatAtt): string {
  if (att.t === 'item') return att.n || '物品';
  // 服务端能从 BetterQuesting 任务库取到任务名时就显示名字，取不到退回通用文案
  return att.n || '分享了一个任务';
}

/** 点开后显示的详情；没有可展开的内容时返回空串 */
export function attDetail(att: ChatAtt): string {
  if (att.t === 'item') return att.h || '';
  return att.i ? `任务 ID\n${att.i}` : '';
}
