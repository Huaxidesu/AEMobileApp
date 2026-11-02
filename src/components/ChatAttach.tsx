// 聊天正文里的结构化附件：物品链接、任务分享。
//
// 为什么不在正文里显示：物品的悬停提示是多行的，任务 ID 是一串十六进制，
// 直接平铺在气泡里会超出消息可读范围。这里收拢为一行可点开的胶囊。
//
// 物品：点一下展开悬停提示（多行文本，可选中）。
// 任务：点一下弹操作面板 —— 去在线任务书（gtnhquestsbook.top）看这一条，
//       或者复制任务 ID / 链接分发（游戏内、群聊均可）。
// 解析在 chatatt.ts（纯函数，有单测），链接拼接在 questbook.ts（同样纯函数、有单测）。
import React, { useMemo, useState } from 'react';
import { Clipboard, Linking, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { attDetail, attLabel, parseAtt } from '../chatatt';
import type { ChatAtt } from '../chatatt';
import { normQuestId, questBookUrl, questShareText } from '../questbook';
import { lookup, questName, zhLines } from '../zhdict';
import { showToast } from '../toast';
import { useTheme, spacing, radius, alpha } from '../theme';

export type { ChatAtt } from '../chatatt';
export { parseAtt } from '../chatatt';

/**
 * 任务附件的操作面板。
 *
 * 用 Modal 而不是聊天页那种内联面板：这里的入口在消息列表里，
 * 不存在「键盘被抢占焦点」的问题（输入框本来就没焦点），Modal 反而避免把状态提升到上层。
 */
function QuestSheet({ att, onClose }: { att: ChatAtt; onClose: () => void }) {
  const { colors } = useTheme();
  const id = normQuestId(att.i);
  const url = questBookUrl(att.i);
  // 字典查不到的就把名字当未知：标题退回通用文案，分享文案只发链接
  const known = questName(att.i) ?? att.n;
  const title = known || attLabel(att);

  const openBook = () => {
    if (!url) return;
    onClose();
    Linking.openURL(url).catch(() => showToast('打不开浏览器', 'bad'));
  };
  /**
   * 复制成功后给个提示 —— 剪贴板没有系统反馈，不提示的话用户会以为没生效。
   *
   * `Clipboard` 是 react-native 核心的旧模块（0.74 还带着，新版会移除），
   * 好处是不增加原生依赖、无需重新执行 prebuild。
   */
  const copy = (text: string, tip: string) => {
    Clipboard.setString(text);
    showToast(tip, 'ok');
    onClose();
  };

  const rows = [
    url
      ? {
          icon: 'open-outline' as const,
          label: '在在线任务书中打开',
          desc: 'gtnhquestsbook.top 里这一条，带完整说明和前置',
          onPress: openBook,
          tone: colors.accent,
        }
      : null,
    id
      ? {
          icon: 'copy-outline' as const,
          label: '复制任务 ID',
          desc: '粘到群里或游戏里，别人能按 ID 查同一个任务',
          onPress: () => copy(id, '已复制任务 ID'),
          tone: colors.textDim,
        }
      : null,
    url
      ? {
          icon: 'link-outline' as const,
          label: '复制分享文案',
          desc: '任务名 + 任务书链接，直接发到群里',
          onPress: () => copy(questShareText(known, att.i), '已复制分享文案'),
          tone: colors.textDim,
        }
      : null,
  ].filter((r): r is NonNullable<typeof r> => !!r);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.mask} activeOpacity={1} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sheetHead}>
            <View style={[styles.sheetIcon, { backgroundColor: colors.warnSoft }]}>
              <Ionicons name="book" size={15} color={colors.warn} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={2}>
                {title}
              </Text>
              <Text style={[styles.sheetSub, { color: colors.textFaint }]} numberOfLines={1}>
                {id || '这条消息里的任务 ID 不完整'}
              </Text>
            </View>
          </View>

          {rows.map((r) => (
            <Pressable
              key={r.label}
              onPress={r.onPress}
              style={({ pressed }) => [
                styles.sheetRow,
                { borderTopColor: colors.border },
                pressed && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <Ionicons name={r.icon} size={16} color={r.tone} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetRowLabel, { color: colors.text }]}>{r.label}</Text>
                <Text style={[styles.sheetRowDesc, { color: colors.textFaint }]} numberOfLines={1}>
                  {r.desc}
                </Text>
              </View>
            </Pressable>
          ))}

          {!url ? (
            <Text style={[styles.sheetNote, { color: colors.textFaint }]}>
              任务分享需要一个 24 位的 BQ 任务 ID 才能拼出链接，这条消息里没有。
            </Text>
          ) : null}

          <TouchableOpacity onPress={onClose} style={[styles.sheetCancel, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={{ color: colors.textDim, fontSize: 14, fontWeight: '600' }}>取消</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function Chip({ att }: { att: ChatAtt }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const isItem = att.t === 'item';

  const icon = isItem ? ('cube-outline' as const) : ('book-outline' as const);
  const tint = isItem ? colors.accent2 : colors.warn;
  const bg = isItem ? colors.accent2Soft : colors.warnSoft;
  // 服务端发的是英文名/任务 ID，这里查本地字典换成中文
  const label = isItem ? (lookup(att.n) ?? attLabel(att)) : (questName(att.i) ?? attLabel(att));
  const detail = isItem ? zhLines(att.h) : attDetail(att);

  // 任务：点一下弹操作面板（去在线任务书 / 复制 ID）；物品：点一下展开悬停提示
  const onPress = isItem ? () => detail && setOpen((v) => !v) : () => setSheet(true);
  const tail = isItem ? (detail ? (open ? 'chevron-up' : 'chevron-down') : null) : 'open-outline';

  return (
    <View style={{ marginTop: 6 }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.chip,
          { backgroundColor: bg, borderColor: alpha(tint, 0.35), opacity: pressed ? 0.75 : 1 },
        ]}
      >
        <Ionicons name={icon} size={12} color={tint} />
        <Text style={[styles.chipText, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
        {tail ? <Ionicons name={tail} size={11} color={alpha(tint, 0.8)} /> : null}
      </Pressable>
      {!isItem && sheet ? <QuestSheet att={att} onClose={() => setSheet(false)} /> : null}
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
  mask: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.m,
    paddingBottom: spacing.l,
    paddingHorizontal: spacing.m,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, paddingBottom: spacing.m },
  sheetIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { fontSize: 14, fontWeight: '700' },
  sheetSub: { fontSize: 10, marginTop: 2, fontVariant: ['tabular-nums'] },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingVertical: 11,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sheetRowLabel: { fontSize: 13.5, fontWeight: '600' },
  sheetRowDesc: { fontSize: 10, marginTop: 2 },
  sheetNote: { fontSize: 10.5, lineHeight: 15, paddingTop: spacing.s },
  sheetCancel: { marginTop: spacing.m, paddingVertical: 11, borderRadius: radius.m, alignItems: 'center' },
});
