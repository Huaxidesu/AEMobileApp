// 聊天页的展示组件：日期分隔、玩家进出系统行、Telegram 式消息组。
// 聊天页和「聊天外观」预览共用，保证设置里看到的就是实际效果。
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colorForName } from './avatars';
import { SkinHead } from './components/SkinHead';
import { DENSITY } from './chatprefs';
import type { ChatPrefs } from './chatprefs';
import type { ChatLike, ChatRow } from './chatgroup';
import { useTheme, spacing } from './theme';

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

export function SystemLine({ msg, join }: { msg: ChatLike; join: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.systemRow}>
      <Ionicons
        name={join ? 'arrow-forward-circle' : 'arrow-back-circle'}
        size={14}
        color={join ? colors.ok : colors.textFaint}
      />
      <Text style={[styles.systemText, { color: colors.textFaint }]} numberOfLines={1}>
        {msg.name || '未知玩家'} {join ? '加入了服务器' : '离开了服务器'}
      </Text>
    </View>
  );
}

/** 一组同一发送者的消息（Telegram 的连珠气泡） */
export function MessageGroup({
  row,
  prefs,
  maxBubbleWidth,
}: {
  row: Extract<ChatRow, { type: 'group' }>;
  prefs: ChatPrefs;
  maxBubbleWidth: number;
}) {
  const { colors } = useTheme();
  const d = DENSITY[prefs.density];
  const mine = row.mine;
  const showAvatar = !mine && prefs.avatarSize > 0;
  const isApp = row.kind === 1;
  const nameColor = colorForName(row.name);
  const timeSize = Math.max(9, prefs.fontSize - 4);

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
            {isApp ? (
              <Ionicons name="phone-portrait" size={10} color={colors.textFaint} style={{ marginLeft: 3 }} />
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
                  <Text
                    selectable
                    style={{
                      color: colors.text,
                      fontSize: prefs.fontSize,
                      lineHeight: Math.round(prefs.fontSize * 1.42),
                      flexShrink: 1,
                    }}
                  >
                    {m.text}
                  </Text>
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
