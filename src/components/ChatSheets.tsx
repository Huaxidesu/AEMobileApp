// 聊天页的三个面板：`/` 模块选择、`@` 候选、AllMusic 命令列表。
//
// 刻意**不用 Modal**：Modal 会抢焦点，输入框一失焦键盘就收起，
// 打完 `/` 面板弹出的同时键盘消失，很难用。这里直接插在消息列表和输入栏之间，
// 键盘保持打开、面板高度受限（约 0.42 屏高，可滚动），不会把聊天页整个盖住。
import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MUSIC_COMMANDS } from '../commands';
import type { ChatModule, MusicCmd } from '../commands';
import { themedStyles, useTheme, spacing, radius, alpha } from '../theme';

/** 面板最高占屏幕的比例（键盘弹起时还会被 flexShrink 继续压） */
const MAX_RATIO = 0.42;

/** 标题区大致高度，用来给列表留出滚动空间 */
const HEADER_H = 46;

function Panel({
  title,
  hint,
  onClose,
  children,
}: {
  title: string;
  hint?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const win = useWindowDimensions();
  // 面板用 maxHeight 而不是固定 height：命令少时面板矮，命令多时到上限后内部滚动。
  // 关键是 flexShrink: 0 —— 不设的话会被上面的消息列表（flex:1）挤成一条缝。
  const cap = Math.round(win.height * MAX_RATIO);

  return (
    <View style={[styles.panel, { maxHeight: cap, borderTopColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={[styles.headerRow, { flexShrink: 0 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          {hint ? (
            <Text style={styles.hint} numberOfLines={1}>
              {hint}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
          <Ionicons name="close" size={17} color={colors.textDim} />
        </Pressable>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flexGrow: 0, flexShrink: 1, maxHeight: Math.max(80, cap - HEADER_H) }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** `/` 或「+」触发的模块选择 */
export function ModuleSheet({
  modules,
  onPick,
  onClose,
}: {
  modules: ChatModule[];
  onPick: (m: ChatModule) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Panel title="选择模块" hint="选中后会插入 @allmusic，并列出它的全部命令" onClose={onClose}>
      <>
        {modules.map((m) => (
          <Pressable
            key={m.id}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
            onPress={() => onPick(m)}
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name={m.icon} size={16} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{m.label}</Text>
              <Text style={styles.rowDesc} numberOfLines={1}>
                {m.desc}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
          </Pressable>
        ))}
      </>
    </Panel>
  );
}

/** `@` 触发的候选：AllMusic + 在线玩家 */
export function MentionSheet({
  players,
  allmusicLabel,
  loading,
  onPick,
  onClose,
}: {
  players: string[];
  allmusicLabel: string;
  loading: boolean;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Panel
      title="提及"
      hint={loading ? '正在读取在线玩家…' : '选玩家插入 @名字；选 AllMusic 打开命令面板'}
      onClose={onClose}
    >
      <>
        <Pressable
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
          onPress={() => onPick(allmusicLabel)}
        >
          <View style={[styles.rowIcon, { backgroundColor: alpha(colors.accent, 0.18) }]}>
            <Ionicons name="musical-notes" size={16} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{allmusicLabel}</Text>
            <Text style={styles.rowDesc} numberOfLines={1}>
              点歌 / 搜歌 / 队列 / 投票
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
        </Pressable>

        {loading ? <ActivityIndicator style={{ marginVertical: spacing.l }} color={colors.accent} /> : null}
        {!loading && players.length === 0 ? (
          <Text style={styles.empty}>没有可提及的玩家（服务器没人在线，或还没人在 App 里说过话）</Text>
        ) : null}

        {players.map((n) => (
          <Pressable
            key={n}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
            onPress={() => onPick(n)}
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="person" size={15} color={colors.textDim} />
            </View>
            <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>
              {n}
            </Text>
          </Pressable>
        ))}
      </>
    </Panel>
  );
}

/** AllMusic 命令面板：常用 / 更多两组，底部显示最近一次执行结果 */
export function CommandSheet({
  result,
  busy,
  onPick,
  onClose,
}: {
  /** 最近一次命令的输出（已去掉颜色码） */
  result: string[];
  busy: boolean;
  /** 带参数占位的命令交给调用方插进输入框，其余直接执行 */
  onPick: (c: MusicCmd) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const basic = useMemo(() => MUSIC_COMMANDS.filter((c) => c.group === 'basic'), []);
  const more = useMemo(() => MUSIC_COMMANDS.filter((c) => c.group === 'more'), []);

  const renderRow = (c: MusicCmd) => (
    <Pressable
      key={`${c.group}:${c.label}`}
      style={({ pressed }) => [styles.cmdRow, pressed && { backgroundColor: colors.surfaceAlt }]}
      onPress={() => onPick(c)}
    >
      <Text style={styles.cmdText} numberOfLines={1}>
        <Text style={{ color: colors.accent }}>/music {c.label}</Text>
        {c.argHint ? <Text style={{ color: colors.textFaint }}> {c.argHint}</Text> : null}
      </Text>
      <Text style={styles.cmdDesc} numberOfLines={1}>
        {c.desc}
      </Text>
      {c.argHint ? <Ionicons name="create-outline" size={13} color={colors.textFaint} /> : null}
    </Pressable>
  );

  return (
    <Panel
      title="点歌"
      hint={busy ? '执行中…' : '带参数的会填进输入框，其余点一下直接执行'}
      onClose={onClose}
    >
      <>
        <Text style={styles.groupLabel}>常用</Text>
        {basic.map(renderRow)}
        <Text style={styles.groupLabel}>更多</Text>
        {more.map(renderRow)}
        {result.length > 0 ? (
          <View style={[styles.resultBox, { borderTopColor: colors.border }]}>
            {result.slice(0, 6).map((line, i) => (
              <Text key={i} style={styles.resultText} numberOfLines={2}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
      </>
    </Panel>
  );
}

const styles = themedStyles((colors) => ({
  panel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.m,
    paddingTop: spacing.s,
    paddingBottom: spacing.s,
    flexShrink: 0,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginBottom: 2 },
  title: { color: colors.text, fontSize: 14, fontWeight: '800' },
  hint: { color: colors.textFaint, fontSize: 10, marginTop: 1 },
  closeBtn: { padding: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: radius.s,
  },
  rowIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  rowDesc: { color: colors.textFaint, fontSize: 10, marginTop: 1 },
  empty: { color: colors.textFaint, fontSize: 11, paddingVertical: spacing.m, paddingHorizontal: 6 },
  groupLabel: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: spacing.s,
    marginBottom: 1,
    marginLeft: 6,
  },
  cmdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: radius.s,
  },
  cmdText: { fontSize: 12.5, fontWeight: '600', flexShrink: 0 },
  cmdDesc: { color: colors.textFaint, fontSize: 10, flex: 1, textAlign: 'right' },
  resultBox: {
    marginTop: spacing.s,
    marginBottom: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.s,
    gap: 3,
  },
  resultText: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
}));
