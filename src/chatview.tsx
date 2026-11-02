// 聊天页的展示组件：日期分隔、系统行（进出 / 成就）、Telegram 式消息组。
// 聊天页和「聊天外观」预览共用，保证设置里看到的就是实际效果。
//
// 正文统一走 McText：还原服务端带过来的 `§` 颜色码，并把 `@我` 高亮成 Telegram 的样子。
//
// 名字行有两种排法（见 chatprefs 的 ChatStyle）：
//   classic —— `[团队] 名字`，点头像展开 `[服务器][世界]`，头像原地不动；
//   pills   —— `名字 [团队] [服务器] [世界]` 一直显示。
// 头像永远不移动：它是连珠气泡的对齐基准，动了整列就歪了。
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colorForName } from './avatars';
import { SkinHead } from './components/SkinHead';
import { AttachChips } from './components/ChatAttach';
import { zh } from './zhdict';
import { DENSITY } from './chatprefs';
import type { ChatPrefs } from './chatprefs';
import type { ChatLike, ChatRow, SystemVariant } from './chatgroup';
import { McText } from './mccolor';
import { useTheme, spacing, alpha } from './theme';

export function timeLabel(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function DayDivider({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.dayRow}>
      <View style={[styles.dayPill, { backgroundColor: colors.surfaceAlt }]}>
        <Text style={[styles.dayText, { color: colors.textFaint }]}>{label}</Text>
      </View>
    </View>
  );
}

/** 居中系统行：玩家进出、玩家完成成就 */
export function SystemLine({ msg, variant }: { msg: ChatLike; variant: SystemVariant }) {
  const { colors } = useTheme();
  // 点歌结果没有「谁做了什么」的结构，`text` 就是整句
  if (variant === 'music') {
    return (
      <View style={styles.systemRow}>
        <Ionicons name="musical-notes" size={13} color={colors.accent} />
        <Text style={[styles.systemText, { color: colors.textDim }]} numberOfLines={3}>
          {msg.text}
        </Text>
      </View>
    );
  }

  const conf =
    variant === 'achievement'
      ? { icon: 'trophy' as const, color: colors.warn, tail: '完成了成就' }
      : variant === 'join'
        ? { icon: 'arrow-forward-circle' as const, color: colors.ok, tail: '加入了服务器' }
        : { icon: 'arrow-back-circle' as const, color: colors.textFaint, tail: '离开了服务器' };

  return (
    <View style={styles.systemRow}>
      <Ionicons name={conf.icon} size={14} color={conf.color} />
      <Text style={[styles.systemText, { color: colors.textFaint }]} numberOfLines={2}>
        {msg.name || '未知玩家'} {conf.tail}
        {variant === 'achievement' && msg.text ? (
          <Text style={{ color: colors.textDim, fontWeight: '600' }}> {zh(msg.text)}</Text>
        ) : null}
      </Text>
    </View>
  );
}

/** 名字前的身份图标：App / 服务器 / AllMusic */
function kindIcon(kind: number): { name: any; color: 'textFaint' | 'accent' | 'textDim' } | null {
  if (kind === 1) return { name: 'phone-portrait', color: 'textFaint' };
  if (kind === 4) return { name: 'megaphone', color: 'textDim' };
  if (kind === 5) return { name: 'disc', color: 'accent' };
  return null;
}

/**
 * MC 颜色码 → 十六进制。
 *
 * 服务端只发码字符（`d` / `b` …），色值在本地定：MC 的纯黑、深蓝在暗色主题下基本看不见，
 * 这里统一往中亮度提了一档，两套主题都能读。
 */
const MC_COLORS: Record<string, string> = {
  '0': '#6B7280',
  '1': '#4A6CF7',
  '2': '#3FA34D',
  '3': '#2AA6A6',
  '4': '#C0392B',
  '5': '#A855F7',
  '6': '#E0A030',
  '7': '#9AA0A6',
  '8': '#6B7280',
  '9': '#5B7CFA',
  a: '#4ADE80',
  b: '#22D3EE',
  c: '#F87171',
  d: '#F472B6',
  e: '#FACC15',
  f: '#F5F7FA',
};

/** 队伍颜色码 → 十六进制；没有队伍或码不合法返回 undefined（调用方回落到白色） */
function teamColor(code?: string): string | undefined {
  if (!code) return undefined;
  return MC_COLORS[code.toLowerCase()];
}

/**
 * 正文为空时的本地文案。
 *
 * 服务端只发结构化附件（谁、什么物品/任务），「分享了物品」这类文案留在 App 里出 ——
 * 服务端不做翻译，也不为多台子服各维护一份语言文件（见 AGENTS.md 的约定）。
 */
function attHint(att?: string): string {
  if (!att) return '';
  try {
    const rows = JSON.parse(att) as { t?: string }[];
    if (!Array.isArray(rows) || rows.length === 0) return '';
    const hasItem = rows.some((r) => r?.t === 'item');
    const hasQuest = rows.some((r) => r?.t === 'quest');
    if (hasItem && hasQuest) return '分享了物品和任务';
    if (hasQuest) return '分享了任务';
    if (hasItem) return '分享了物品';
    return '';
  } catch {
    return '';
  }
}

/**
 * 正文里混着 BetterQuesting 的分享标记（`betterquesting.msg.sharequest:<id>`）。
 *
 * 旧服务端会把玩家的原始输入（就是那串标记）当正文发过来，手机上显示的是一串乱码。
 * 服务端已经改成正文留空了，这里兼容历史消息。
 */
function looksLikeQuestMarker(text?: string): boolean {
  return !!text && text.indexOf('betterquesting.msg.sharequest:') >= 0;
}

/**
 * 旧消息兼容：正文里只有分享标记、没有结构化 `att` 字段的（3.4.1 之前落盘的），
 * 现场拼一条任务附件出来，这样它和正常任务分享一样能点开在线任务书。
 */
function questAttFromText(text?: string): string | undefined {
  if (!text) return undefined;
  const marker = 'betterquesting.msg.sharequest:';
  const at = text.indexOf(marker);
  if (at < 0) return undefined;
  const id = text.slice(at + marker.length).trim();
  return id ? JSON.stringify([{ t: 'quest', i: id }]) : undefined;
}

/** 三种标签的图标：全部用 Ionicons 的线性（-outline）系列，画风一致、颜色随文字走 */
const TAG_ICON = {
  team: 'people-outline',
  server: 'earth-outline',
  world: 'map-outline',
} as const;

type TagKind = keyof typeof TAG_ICON;

/**
 * 名字旁的标签：线性图标 + 文字，描边和文字同色，底色是同一个颜色的 14% 透明。
 *
 * 团队用 ServerUtilities 配的队伍色（和名字、游戏内一致）；
 * 服务器和世界用外观页里配的颜色（默认橙 / 绿）。
 */
function InfoTag({ kind, label, color }: { kind: TagKind; label: string; color: string }) {
  return (
    <View
      style={[
        styles.tag,
        { backgroundColor: alpha(color, 0.14), borderColor: alpha(color, 0.42) },
      ]}
    >
      <Ionicons name={TAG_ICON[kind]} size={10} color={color} />
      <Text style={[styles.tagText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * 可展开的标签块（classic 样式用）。
 *
 * 展开时宽度从 0 动画到自然宽度，后面的团队标签和名字被自然推开 —— 头像不动。
 *
 * 为什么要那个隐形的「量尺」：被 `overflow: hidden` 裁剪的父容器会把子项宽度约束成 0，
 * 子项自己 `onLayout` 永远量到 0。所以另挂一份绝对定位 + 全透明的同样内容，只用来取宽度。
 */
function ExpandArea({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [natural, setNatural] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [open, anim]);

  const width = anim.interpolate({ inputRange: [0, 1], outputRange: [0, natural] });
  const opacity = anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.55, 1] });
  // 标签从左边滑进来一点点，比纯淡入更有「抽屉拉开」的感觉
  const shift = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-Math.min(14, Math.round(natural * 0.35)), 0],
  });

  return (
    <>
      <View
        pointerEvents="none"
        style={styles.ruler}
        onLayout={(e) => {
          const w = Math.round(e.nativeEvent.layout.width);
          if (w > 0 && w !== natural) setNatural(w);
        }}
      >
        {children}
      </View>
      <Animated.View style={{ width, opacity, overflow: 'hidden' }}>
        <Animated.View
          style={{
            flexDirection: 'row',
            width: natural || undefined,
            transform: [{ translateX: shift }],
          }}
        >
          {children}
        </Animated.View>
      </Animated.View>
    </>
  );
}

/** 一组同一发送者的消息（Telegram 的连珠气泡） */
export function MessageGroup({
  row,
  prefs,
  maxBubbleWidth,
  me,
  expanded = false,
  onToggleExpand,
}: {
  row: Extract<ChatRow, { type: 'group' }>;
  prefs: ChatPrefs;
  maxBubbleWidth: number;
  /** 自己的聊天昵称：正文里 `@我` 会高亮 */
  me?: string;
  /** classic 样式下这组是否展开了服务器 / 世界标签 */
  expanded?: boolean;
  /** 点头像切换展开；不传就不响应点击（设置页预览） */
  onToggleExpand?: () => void;
}) {
  const { colors } = useTheme();
  const d = DENSITY[prefs.density];
  const mine = row.mine;
  const showAvatar = !mine && prefs.avatarSize > 0;
  const isApp = row.kind === 1;
  // 名字和团队都用队伍颜色；没队伍的玩家用白色（颜色 = 有队伍，语义干净）
  const teamCol = teamColor(row.teamColor);
  const nameColor = teamCol ?? colors.text;
  const timeSize = Math.max(9, prefs.fontSize - 4);
  const icon = kindIcon(row.kind);
  // 玩家消息才有队伍 / 世界；服务器广播和 AllMusic 只有来源服
  const isPlayer = row.kind === 0 || row.kind === 1;
  const pills = prefs.styleMode === 'pills';
  const canExpand = isPlayer && !!onToggleExpand && (!!row.srv || !!row.world);
  // 服务器标签一律用外观页配的颜色（默认橙）。2026-11-01 试过「本服灰、跨服彩」，
  // 用户觉得灰的不好看，改回统一着色 —— 少一档视觉规则，也少一个要解释的东西。
  const srvColor = prefs.serverColor;

  const nameText = (
    <Text
      style={[styles.nameText, { color: nameColor, fontSize: Math.max(10, prefs.fontSize - 2) }]}
      numberOfLines={1}
    >
      {row.name || '未知玩家'}
    </Text>
  );

  return (
    <View
      style={[
        styles.groupRow,
        {
          justifyContent: mine ? 'flex-end' : 'flex-start',
          marginBottom: d.groupGap,
        },
      ]}
    >
      {showAvatar ? (
        <Pressable
          onPress={canExpand ? onToggleExpand : undefined}
          hitSlop={8}
          style={({ pressed }) => [
            { marginRight: spacing.s, marginTop: 1 },
            pressed && canExpand ? { opacity: 0.55 } : null,
          ]}
        >
          <SkinHead name={row.name} size={prefs.avatarSize} kind={row.kind} badge={isApp} />
        </Pressable>
      ) : null}

      <View style={{ maxWidth: maxBubbleWidth, flexShrink: 1 }}>
        {!mine ? (
          <View style={styles.nameRow}>
            {pills ? (
              // 样式1：名字在最前，三个标签跟在后面，一直显示
              <>
                {nameText}
                {icon ? (
                  <Ionicons
                    name={icon.name}
                    size={10}
                    color={(colors as any)[icon.color]}
                    style={{ marginLeft: 3, marginRight: 4 }}
                  />
                ) : null}
                {row.team ? <InfoTag kind="team" label={row.team} color={teamCol ?? colors.textDim} /> : null}
                {row.srv ? <InfoTag kind="server" label={row.srv} color={srvColor} /> : null}
                {row.world ? <InfoTag kind="world" label={row.world} color={prefs.worldColor} /> : null}
              </>
            ) : (
              // classic：`[团队] 名字`；点头像在团队前面展开服务器 / 世界
              <>
                {isPlayer ? (
                  <ExpandArea open={expanded}>
                    {row.srv ? <InfoTag kind="server" label={row.srv} color={srvColor} /> : null}
                    {row.world ? <InfoTag kind="world" label={row.world} color={prefs.worldColor} /> : null}
                  </ExpandArea>
                ) : row.srv ? (
                  <InfoTag kind="server" label={row.srv} color={srvColor} />
                ) : null}
                {row.team ? <InfoTag kind="team" label={row.team} color={teamCol ?? colors.textDim} /> : null}
                {nameText}
                {icon ? (
                  <Ionicons
                    name={icon.name}
                    size={10}
                    color={(colors as any)[icon.color]}
                    style={{ marginLeft: 3 }}
                  />
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {row.msgs.map((m, i) => {
          const first = i === 0;
          // 任务是 BQ 的分享标记时不显示正文（历史消息里还留着），改由 attHint 出「分享了任务」
          const bodyText = looksLikeQuestMarker(m.text) ? '' : m.text;
          // 没有结构化附件的历史消息，从正文的标记里补一条任务附件
          const att = m.att ?? questAttFromText(m.text);
          const bubbleRadius = Math.max(10, prefs.fontSize + 2);
          const tight = 5;
          return (
            <View
              key={`${m.boot}:${m.seq}`}
              style={{ marginTop: first ? 0 : d.innerGap, alignItems: mine ? 'flex-end' : 'flex-start' }}
            >
              {prefs.timeMode === 'above' ? (
                <Text style={[styles.aboveTime, { color: colors.textFaint, fontSize: timeSize }]}>
                  {timeLabel(m.ts)}
                </Text>
              ) : null}
              <View
                style={{
                  maxWidth: '100%',
                  backgroundColor: mine ? colors.accentSoft : colors.surfaceAlt,
                  paddingHorizontal: d.padH,
                  paddingVertical: d.padV,
                  borderRadius: bubbleRadius,
                  borderTopLeftRadius: !mine && first ? tight : bubbleRadius,
                  borderTopRightRadius: mine && first ? tight : bubbleRadius,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', flexShrink: 1 }}>
                  {bodyText || !att ? (
                    <McText
                      text={bodyText}
                      selectable
                      highlight={me}
                      highlightColor={colors.accent}
                      highlightBg={alpha(colors.accent, 0.22)}
                      style={{
                        color: colors.text,
                        fontSize: prefs.fontSize,
                        lineHeight: Math.round(prefs.fontSize * 1.42),
                        flexShrink: 1,
                      }}
                    />
                  ) : (
                    // 只有附件、没有正文（NEI 分享）：文案在本地出，服务端不发语言
                    <Text
                      style={{
                        color: colors.textDim,
                        fontSize: prefs.fontSize,
                        lineHeight: Math.round(prefs.fontSize * 1.42),
                        flexShrink: 1,
                      }}
                    >
                      {attHint(att)}
                    </Text>
                  )}
                  {prefs.timeMode === 'inside' ? (
                    <Text style={{ color: colors.textFaint, fontSize: timeSize, marginLeft: 8 }}>{timeLabel(m.ts)}</Text>
                  ) : null}
                </View>
                {/* 物品链接 / 任务分享：正文里已经被摘掉，这里画成可展开的胶囊 */}
                <AttachChips att={att} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dayRow: { alignItems: 'center', marginBottom: spacing.m, marginTop: spacing.s },
  dayPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  dayText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  systemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.m,
  },
  systemText: { fontSize: 11, flexShrink: 1 },
  groupRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing.l },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2, marginLeft: 3 },
  nameText: { fontWeight: '700', flexShrink: 1 },
  aboveTime: { marginBottom: 2, marginHorizontal: 3 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 4,
    maxWidth: 96,
  },
  tagText: { fontSize: 9, fontWeight: '600' },
  /** 隐形量尺：不参与布局，只用来取两个标签的自然宽度 */
  ruler: {
    position: 'absolute',
    left: 0,
    top: 0,
    flexDirection: 'row',
    opacity: 0,
  },
});
