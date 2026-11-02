// 英文名 → 中文名的本地查表。
//
// 服务端是 en_US，聊天里带出来的物品名、成就名只能是英文。翻译放在这里做，
// 服务端只发原始文本 —— 多台子服不用各自装汉化包，服务端也不执行字典查询。
//
// 数据由 tools/gen_zhdict.py 在构建期从「服务端 mods 的 en_US.lang + GregTech.lang」
// 和「汉化包的 zh_CN.lang」按同一个 key 配对生成：
//   ZHDICT_RAW  约 2.4 万条「英文名 → 中文名」，物品和成就名用
//   BQQUEST_RAW 约 3300 条「任务 base64 ID → 中文任务名」，任务分享用
import { BQQUEST_RAW, ZHDICT_RAW } from './zhdictdata';

let table: Map<string, string> | null = null;
let questTable: Map<string, string> | null = null;

/** `§` 颜色码（含 `§r`）；服务端有些物品名带着它过来 */
const CODES = /§[0-9a-fk-orA-FK-OR]/g;

function parse(raw: string): Map<string, string> {
  const m = new Map<string, string>();
  let from = 0;
  while (from < raw.length) {
    let end = raw.indexOf('\n', from);
    if (end < 0) end = raw.length;
    const line = raw.slice(from, end);
    from = end + 1;
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    m.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return m;
}

function ensure(): Map<string, string> {
  if (!table) table = parse(ZHDICT_RAW);
  return table;
}

function ensureQuests(): Map<string, string> {
  if (!questTable) questTable = parse(BQQUEST_RAW);
  return questTable;
}

/** 查一条英文名；没有对应条目返回 undefined */
export function lookup(name?: string | null): string | undefined {
  if (!name) return undefined;
  const table = ensure();
  const hit = table.get(name);
  if (hit !== undefined) return hit;
  // 服务端发来的物品名可能带 `§` 颜色码（NEI 分享用的是带码的显示名），而字典的键是
  // 剥过码的纯文本。不兜这一下，TST 那类名字带颜色的物品永远显示英文。
  if (name.indexOf('§') < 0) return undefined;
  return table.get(name.replace(CODES, '').trim());
}

/** 翻译一段文本；翻不了就原样返回（聊天里绝大多数文本走这条） */
export function zh(text: string): string {
  return lookup(text) ?? text;
}

/**
 * 逐行翻译多行文本（物品的悬停提示）。
 * 只做整行匹配 —— tooltip 里还有 "Durability: 100" 这种内容，逐词替换会把句子拆坏。
 */
export function zhLines(text?: string | null): string {
  if (!text) return '';
  if (text.indexOf('\n') < 0) return zh(text);
  return text
    .split('\n')
    .map((line) => {
      const t = lookup(line.trim());
      return t ?? line;
    })
    .join('\n');
}

// --------------------------------------------------------------- 任务名

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * UUID 字符串 → BetterQuesting 的 22 字符 base64（无填充）。
 *
 * 任务分享标记里带的是 UUID，而 BQ 的语言 key 用的是自己的 base64 编码
 * （`betterquesting.quest.<22 位>.name`），所以要在这里转一次。
 */
export function uuidToBq(uuid: string): string | null {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32 || /[^0-9a-fA-F]/.test(hex)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < 32; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  let out = '';
  for (let i = 0; i < 16; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < 16 ? bytes[i + 1] : 0;
    const b2 = i + 2 < 16 ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < 16) out += B64[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < 16) out += B64[b2 & 63];
  }
  return out;
}

/** 按任务 ID 查中文任务名；ID 可能是 UUID，也可能已经是 BQ 的 base64 */
export function questName(id?: string | null): string | undefined {
  if (!id) return undefined;
  const q = ensureQuests();
  const direct = q.get(id.replace(/=+$/, ''));
  if (direct) return direct;
  const b64 = uuidToBq(id);
  return b64 ? q.get(b64) : undefined;
}

/** 预热：App 启动后空闲时调一次，避免第一次点开物品卡片卡一下 */
export function warmup(): void {
  ensure();
}
