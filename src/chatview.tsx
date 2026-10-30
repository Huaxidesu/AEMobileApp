// 聊天页的展示组件：日期分隔、系统行（进出 / 成就）、Telegram 式消息组。
// 聊天页和「聊天外观」预览共用，保证设置里看到的就是实际效果。
//
// 正文统一走 McText：还原服务端带过来的 `§` 颜色码，并把 `@我` 高亮成 Telegram 的样子。
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colorForName } from './avatars';
import { SkinHead } from './components/SkinHead';
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
          <Text style={{ color: colors.textDim, fontWeight: '600' }}> {msg.text}</Text>
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

/** 一组同一发送者的消息（Telegram 的连珠气泡） */
export function MessageGroup({
  row,
  prefs,
  maxBubbleWidth,
  me,
}: {
  row: Extract<ChatRow, { type: 'group' }>;
  prefs: ChatPrefs;
  maxBubbleWidth: number;
  /** 自己的聊天昵称：正文里 `@我` 会高亮 */
  me?: string;
}) {
  const { colors } = useTheme();
  const d = DENSITY[prefs.density];
  const mine = row.mine;
  const showAvatar = !mine && prefs.avatarSize > 0;
  const isApp = row.kind === 1;
  const nameColor = colorForName(row.name);
  const timeSize = Math.max(9, prefs.fontSize - 4);
  const icon = kindIcon(row.kind);

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
        <View style={{ marginRight: spacing.s, marginTop: 1 }}>
          <SkinHead name={row.name} size={prefs.avatarSize} kind={row.kind} badge={isApp} />
        </View>
      ) : null}

      <View style={{ maxWidth: maxBubbleWidth, flexShrink: 1 }}>
        {!mine ? (
          <View style={styles.nameRow}>
            <Text style={[styles.nameText, { color: nameColor, fontSize: Math.max(10, prefs.fontSize - 2) }]} numberOfLines={1}>
              {row.name || '未知玩家'}
            </Text>
            {icon ? (
              <Ionicons name={icon.name} size={10} color={(colors as any)[icon.color]} style={{ marginLeft: 3 }} />
            ) : null}
          </View>
        ) : null}

        {row.msgs.map((m, i) => {
          const first = i === 0;
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
                  <McText
                    text={m.text}
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
                  {prefs.timeMode === 'inside' ? (
                    <Text style={{ color: colors.textFaint, fontSize: timeSize, marginLeft: 8 }}>{timeLabel(m.ts)}</Text>
                  ) : null}
                </View>
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
});
