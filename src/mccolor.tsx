// 聊天正文的渲染组件：Minecraft 颜色码 + Telegram 式 `@我` 高亮。
//
// 解析逻辑在 mcformat.ts（纯函数，有单测），这里只负责拼 <Text> 片段。
import React, { useMemo } from 'react';
import { Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { parseMc, splitMention } from './mcformat';

export { MENTION_RE, mentions, parseMc, plainMc, readable, splitMention } from './mcformat';
export type { McSeg } from './mcformat';

export interface McTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  /** 被 @ 到的名字（一般是自己的聊天昵称）；命中时整段高亮 */
  highlight?: string;
  highlightColor?: string;
  highlightBg?: string;
  selectable?: boolean;
  numberOfLines?: number;
}

interface Piece {
  key: string;
  text: string;
  style: TextStyle;
}

/**
 * 渲染一条带颜色码的聊天正文。
 *
 * 样式合并顺序：外层 style → 颜色码 → `@提及` 高亮（只覆盖颜色、背景和字重）。
 */
export function McText({ text, style, highlight, highlightColor, highlightBg, selectable, numberOfLines }: McTextProps) {
  const pieces = useMemo<Piece[]>(() => {
    const out: Piece[] = [];
    let n = 0;
    for (const seg of parseMc(text)) {
      const base: TextStyle = {};
      if (seg.color) base.color = seg.color;
      if (seg.bold) base.fontWeight = '700';
      if (seg.italic) base.fontStyle = 'italic';
      const deco: string[] = [];
      if (seg.underline) deco.push('underline');
      if (seg.strike) deco.push('line-through');
      if (deco.length) base.textDecorationLine = deco.join(' ') as TextStyle['textDecorationLine'];

      if (!highlight) {
        out.push({ key: `p${n++}`, text: seg.text, style: base });
        continue;
      }
      for (const part of splitMention(seg.text, highlight)) {
        if (!part.text) continue;
        out.push({
          key: `p${n++}`,
          text: part.text,
          style: part.hit
            ? { ...base, color: highlightColor ?? base.color, backgroundColor: highlightBg, fontWeight: '700' }
            : base,
        });
      }
    }
    return out;
  }, [text, highlight, highlightColor, highlightBg]);

  return (
    <Text style={style} selectable={selectable} numberOfLines={numberOfLines}>
      {pieces.map((p) => (
        <Text key={p.key} style={p.style}>
          {p.text}
        </Text>
      ))}
    </Text>
  );
}
