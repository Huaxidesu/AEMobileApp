// 聊天正文里的结构化附件：物品链接、任务分享。
//
// 为什么不在正文里显示：物品的悬停提示是多行的，任务 ID 是一串十六进制，
// 直接铺在气泡里会把整条消息撑爆。这里收成一行可点开的胶囊，点一下展开详情。
// 解析在 chatatt.ts（纯函数，有单测），本文件只负责画。
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { attDetail, attLabel, parseAtt } from '../chatatt';
import type { ChatAtt } from '../chatatt';
import { lookup, questName, zhLines } from '../zhdict';
import { useTheme, spacing, alpha } from '../theme';

export type { ChatAtt } from '../chatatt';
export { parseAtt } from '../chatatt';

function Chip({ att }: { att: ChatAtt }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const isItem = att.t === 'item';

  const icon = isItem ? ('cube-outline' as const) : ('book-outline' as const);
  const tint = isItem ? colors.accent2 : colors.warn;
  const bg = isItem ? colors.accent2Soft : colors.warnSoft;
  // 服务端发的是英文名/任务 ID，这里查本地字典换成中文
  const label = isItem ? (lookup(att.n) ?? attLabel(att)) : (questName(att.i) ?? attLabel(att));
  const detail = isItem ? zhLines(att.h) : attDetail(att);

  return (
    <View style={{ marginTop: 6 }}>
      <Pressable
        onPress={() => detail && setOpen((v) => !v)}
        style={({ pressed }) => [
          styles.chip,
          { backgroundColor: bg, borderColor: alpha(tint, 0.35), opacity: pressed ? 0.75 : 1 },
        ]}
      >
        <Ionicons name={icon} size={12} color={tint} />
        <Text style={[styles.chipText, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={11} color={alpha(tint, 0.8)} />
        ) : null}
      </Pressable>
      {open && detail ? (
        <View style={[styles.detail, { backgroundColor: colors.surface, borderColor: alpha(tint, 0.25) }]}>
          <Text style={[styles.detailText, { color: colors.textDim }]} selectable>
            {detail}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** 一条消息的全部附件；没有附件时返回 null（调用方直接不渲染） */
export function AttachChips({ att }: { att?: string }) {
  const list = useMemo(() => parseAtt(att), [att]);
  if (list.length === 0) return null;
  return (
    <View style={{ marginTop: 2 }}>
      {list.map((a, i) => (
        <Chip key={`${a.t}:${a.n ?? a.i ?? i}`} att={a} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  detail: {
    marginTop: 4,
    paddingHorizontal: spacing.s,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  detailText: { fontSize: 11, lineHeight: 16 },
});
