// Minecraft 颜色 / 格式码的解析（纯函数，不依赖 React，可单测）。
//
// 服务端会把聊天原文里的 `§` 码原样带过来（`ChatFormat.sanitizeColored` 只放行
// 0-9a-f 和 l/o/n/m/r，`§k` 已被丢弃），所以这里要还原成真实样式。
// 渲染在 mccolor.tsx，两边共用这里的解析结果。

/** 0-9a-f 十六进制颜色（和游戏里一模一样） */
export const MC_COLORS: Record<string, string> = {
  '0': '#000000',
  '1': '#0000AA',
  '2': '#00AA00',
  '3': '#00AAAA',
  '4': '#AA0000',
  '5': '#AA00AA',
  '6': '#FFAA00',
  '7': '#AAAAAA',
  '8': '#555555',
  '9': '#5555FF',
  a: '#55FF55',
  b: '#55FFFF',
  c: '#FF5555',
  d: '#FF55FF',
  e: '#FFFF55',
  f: '#FFFFFF',
};

export interface McSeg {
  text: string;
  /** 已经提亮过的可读颜色；没写颜色码时为 undefined（跟随外层样式） */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * 深色气泡上的 `§0`/`§8` 几乎看不见，按感知亮度往白里混一点。
 * 只动太暗的颜色，`§4`/`§2` 这类正常颜色原样保留。
 *
 * 用「混白」而不是「乘系数」：纯黑乘任何数还是纯黑。
 */
export function readable(hex: string, minL = 0.42): string {
  const [r, g, b] = rgb(hex);
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (l >= minL) return hex;
  const t = (minL - l) / (1 - l);
  return toHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}

const CODE_COLOR = /[0-9a-f]/;
const CODE_STYLE = /[lonmrk]/;

/**
 * 把带 `§`/`&` 码的文本切成片段。
 *
 * - `§r` 重置到默认样式；
 * - 颜色码只改颜色，粗体/斜体保留（和游戏行为一致）；
 * - `§k`（乱码）服务端已经删掉，这里也当无效码吞掉；
 * - 没写颜色的片段 `color` 为 undefined，跟随调用方给的基础色。
 */
export function parseMc(input: string): McSeg[] {
  const out: McSeg[] = [];
  if (!input) return out;

  let color: string | undefined;
  let bold = false;
  let italic = false;
  let underline = false;
  let strike = false;
  let buf = '';

  const flush = () => {
    if (!buf) return;
    out.push({
      text: buf,
      color,
      bold: bold || undefined,
      italic: italic || undefined,
      underline: underline || undefined,
      strike: strike || undefined,
    });
    buf = '';
  };

  for (let i = 0; i < input.length; ) {
    const ch = input[i];
    if ((ch === '§' || ch === '&') && i + 1 < input.length) {
      const code = input[i + 1].toLowerCase();
      if (CODE_COLOR.test(code) || CODE_STYLE.test(code)) {
        flush();
        i += 2;
        if (code === 'r') {
          color = undefined;
          bold = italic = underline = strike = false;
        } else if (CODE_COLOR.test(code)) {
          // 颜色码只改颜色，不动粗体/斜体（和游戏里一致，只有 §r 才全清）
          color = readable(MC_COLORS[code]);
        } else if (code === 'l') bold = true;
        else if (code === 'o') italic = true;
        else if (code === 'n') underline = true;
        else if (code === 'm') strike = true;
        // §k：无效码，直接吞掉
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/** 去掉所有颜色/格式码（复制、通知预览、日志用） */
export function plainMc(input: string): string {
  return parseMc(input)
    .map((s) => s.text)
    .join('');
}

/** `@名字`：字母数字下划线 + 中文，最长 16（和服务端 MENTION 正则一致） */
export const MENTION_RE = /@[A-Za-z0-9_\u4e00-\u9fa5]{1,16}/g;

/** 文本里是否 @ 了某个人（大小写不敏感，和游戏内行为一致） */
export function mentions(text: string, who: string): boolean {
  if (!who) return false;
  const plain = plainMc(text);
  if (!plain.toLowerCase().includes(`@${who}`.toLowerCase())) return false;
  // 必须按词边界匹配：@Huaxidesu2 不算 @Huaxidesu
  const re = new RegExp(`@${who.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_\\u4e00-\\u9fa5])`, 'i');
  return re.test(plain);
}

/**
 * 把一段文本按 `@某人` 切开（渲染高亮用）。
 * 返回 `[是否命中, 片段]` 交替的数组，命中片段是原文里的一段（含 @）。
 */
export function splitMention(text: string, who: string): { text: string; hit: boolean }[] {
  if (!who) return [{ text, hit: false }];
  const target = `@${who}`.toLowerCase();
  const lower = text.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let from = 0;
  let idx = lower.indexOf(target);
  while (idx >= 0) {
    const end = idx + target.length;
    const after = text[end];
    const boundary = !after || !/[A-Za-z0-9_\u4e00-\u9fa5]/.test(after);
    if (!boundary) {
      idx = lower.indexOf(target, idx + 1);
      continue;
    }
    if (idx > from) out.push({ text: text.slice(from, idx), hit: false });
    out.push({ text: text.slice(idx, end), hit: true });
    from = end;
    idx = lower.indexOf(target, from);
  }
  if (from < text.length) out.push({ text: text.slice(from), hit: false });
  return out;
}
