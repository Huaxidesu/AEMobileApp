// 聊天页的三个面板：`/` 模块选择、`@` 候选、AllMusic 命令列表。
//
// 刻意**不用 Modal**：Modal 会抢焦点，输入框一失焦键盘就收起，
// 打完 `/` 面板弹出的同时键盘消失，很难用。这里直接插在消息列表和输入栏之间，
// 键盘保持打开、面板高度受限（约 0.42 屏高，可滚动），不会把聊天页整个盖住。
import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MUSIC_COMMANDS } from '../commands';
import { parseOutput } from '../musicout';
import type { MusicAction } from '../musicout';
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
  onBack,
  scrollRef,
  children,
}: {
  title: string;
  hint?: string;
  onClose: () => void;
  /** 有值时标题左边显示返回箭头（结果子视图用） */
  onBack?: () => void;
  /** 面板内容滚到顶 / 底时用（命令面板要自动把结果滚进视野） */
  scrollRef?: React.RefObject<ScrollView | null>;
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
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="chevron-back" size={18} color={colors.accent} />
          </Pressable>
        ) : null}
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
        ref={scrollRef}
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

/** AllMusic 命令面板：顶部是最近一次执行结果（可点），下面是常用 / 更多两组命令 */
export function CommandSheet({
  result,
  error,
  busy,
  lastLabel,
  mode,
  onPick,
  onAction,
  onBack,
  onClose,
}: {
  /** 最近一次命令的输出（已去掉颜色码） */
  result: string[];
  /** 人话错误；空字符串表示成功 */
  error: string;
  busy: boolean;
  /** 最近执行的命令名（`search` / `list` …），显示在结果标题上 */
  lastLabel: string;
  /** `result` = 只显示结果（搜歌/队列的子视图）；`commands` = 命令列表 */
  mode: 'commands' | 'result';
  /** 带参数占位的命令交给调用方进参数模式，其余直接执行 */
  onPick: (c: MusicCmd) => void;
  /** 点结果里的条目：搜索结果 → 点歌；`[点我…]` 行 → 执行那条命令 */
  onAction: (a: MusicAction) => void;
  /** 从结果子视图回到命令列表 */
  onBack: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const basic = useMemo(() => MUSIC_COMMANDS.filter((c) => c.group === 'basic'), []);
  const more = useMemo(() => MUSIC_COMMANDS.filter((c) => c.group === 'more'), []);
  const { actions, texts } = useMemo(() => parseOutput(result), [result]);
  const hasResult = busy || !!error || result.length > 0;

  // 结果摘要：取最后一行「人话」（AllMusic 的「已点歌：xxx」「投票已发起」都在最后），
  // 跳过 `/music nextpage` 这类纯命令提示
  const summary =
    [...texts].reverse().find((t) => !/\/music\s/i.test(t)) ??
    (actions.length ? `${actions.length} 条结果` : '');

  // 执行完把结果滚进视野（结果在面板顶部，命令列表在下面）
  useEffect(() => {
    if (hasResult) scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [hasResult, result, error]);

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
      title={mode === 'result' ? (lastLabel === 'search' ? '搜索结果' : '队列') : '点歌'}
      hint={
        busy
          ? '执行中…'
          : mode === 'result'
            ? '点一条直接点歌，左上的箭头回命令列表'
            : '带参数的命令会进「填参数」模式，其余点一下直接执行'
      }
      onClose={onClose}
      scrollRef={scrollRef}
      onBack={mode === 'result' ? onBack : undefined}
    >
      <>
        {hasResult ? (
          <View style={[styles.resultBox, { borderBottomColor: colors.border }]}>
            <View style={styles.resultHead}>
              <Ionicons
                name={busy ? 'time-outline' : error ? 'alert-circle' : 'checkmark-circle'}
                size={13}
                color={busy ? colors.textDim : error ? colors.bad : colors.ok}
              />
              <Text
                style={[styles.resultHeadText, { color: error ? colors.bad : colors.text }]}
                numberOfLines={2}
              >
                {busy
                  ? '执行中…'
                  : error
                    ? error
                    : `${lastLabel ? `/${lastLabel} · ` : ''}${summary || '已执行'}`}
              </Text>
            </View>

            {actions.map((a, i) =>
              a.kind === 'select' ? (
                <Pressable
                  key={`a${i}`}
                  style={({ pressed }) => [styles.entryRow, pressed && { backgroundColor: colors.surfaceAlt }]}
                  onPress={() => onAction(a)}
                >
                  <Text style={[styles.entryIndex, { color: colors.accent }]}>{a.index}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.entryTitle} numberOfLines={1}>
                      {a.label || a.raw}
                    </Text>
                    {a.sub ? (
                      <Text style={styles.entrySub} numberOfLines={1}>
                        {a.sub}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="play-circle-outline" size={16} color={colors.accent} />
                </Pressable>
              ) : (
                <Pressable
                  key={`a${i}`}
                  style={({ pressed }) => [styles.entryRow, pressed && { backgroundColor: colors.surfaceAlt }]}
                  onPress={() => onAction(a)}
                >
                  <Ionicons
                    name={a.needsArg ? 'create-outline' : 'play-outline'}
                    size={13}
                    color={colors.textFaint}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.entryTitle, { color: colors.accent }]} numberOfLines={1}>
                      {a.label}
                    </Text>
                    {a.sub ? (
                      <Text style={styles.entrySub} numberOfLines={1}>
                        {a.sub}
                      </Text>
                    ) : null}
                  </View>
                  {a.needsArg ? (
                    <Text style={[styles.entrySub, { color: colors.warn }]}>需填参数</Text>
                  ) : null}
                </Pressable>
              ),
            )}

            {texts.slice(0, 10).map((l, i) => (
              <Text key={`t${i}`} style={styles.resultText} numberOfLines={2}>
                {l}
              </Text>
            ))}
          </View>
        ) : null}

        {mode === 'commands' ? (
          <>
            <Text style={styles.groupLabel}>常用</Text>
            {basic.map(renderRow)}
            <Text style={styles.groupLabel}>更多</Text>
            {more.map(renderRow)}
          </>
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
    marginTop: spacing.xs,
    marginBottom: spacing.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.s,
    gap: 3,
  },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  resultHeadText: { fontSize: 11, flex: 1, fontWeight: '600' },
  resultHint: { fontSize: 10 },
  resultText: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: radius.s,
  },
  entryIndex: { fontSize: 12, fontWeight: '700', minWidth: 18, textAlign: 'right' },
  entryTitle: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
  entrySub: { color: colors.textFaint, fontSize: 10, marginTop: 1 },
}));
