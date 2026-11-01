// 聊天样式：名字行两种排法二选一。独立成一页（不放「聊天外观」里），
// 因为它改的是结构而不只是尺寸，而且两种样式的操作方式不同（一种要点头像展开）。
//
// 预览用聊天页同一套 MessageGroup，看到的就是实际效果。
import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { themedStyles, useTheme, spacing, radius } from '../theme';
import { useChatPrefs } from '../chatprefs';
import type { ChatStyle } from '../chatprefs';
import { MessageGroup } from '../chatview';
import type { ChatRow } from '../chatgroup';

type GroupRow = Extract<ChatRow, { type: 'group' }>;

export default function ChatStyleScreen() {
  const { colors } = useTheme();
  const { prefs, setStyleMode } = useChatPrefs();
  const win = useWindowDimensions();
  /** 预览卡里的展开状态：只影响演示，不动真实配置 */
  const [expanded, setExpanded] = useState(true);

  const now = Date.now();
  const msg = (seq: number, name: string, text: string, dt: number) => ({
    boot: 0,
    seq,
    kind: 0,
    name,
    text,
    ts: now + dt,
  });
  const row: GroupRow = {
    type: 'group',
    key: 'style-preview',
    name: 'Huaxidesu',
    kind: 0,
    mine: false,
    srv: '天空树',
    team: '华溪岛',
    teamColor: 'd',
    world: '主世界',
    msgs: [
      msg(1, 'Huaxidesu', '晚上一起去挖矿吗', -3 * 60000),
      msg(2, 'Huaxidesu', '我这边有铁镐', -2 * 60000),
    ],
  };

  // 卡片内左右各有内边距，按实际可用宽度换算气泡上限
  const previewWidth = Math.max(180, win.width - spacing.l * 2 - spacing.m * 2);
  const maxBubbleWidth = Math.round((previewWidth * prefs.bubbleMaxWidth) / 100);

  const Option = ({
    mode,
    title,
    desc,
    children,
  }: {
    mode: ChatStyle;
    title: string;
    desc: string;
    children: React.ReactNode;
  }) => {
    const on = prefs.styleMode === mode;
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setStyleMode(mode)}
        style={[
          styles.option,
          { borderColor: on ? colors.accent : colors.border, backgroundColor: colors.surface },
        ]}
      >
        <View style={styles.optionHead}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.optionTitle, on && { color: colors.accent }]}>{title}</Text>
            <Text style={styles.optionDesc}>{desc}</Text>
          </View>
          <Ionicons
            name={on ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
            color={on ? colors.accent : colors.textFaint}
          />
        </View>
        <View style={[styles.previewBox, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          {children}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl, gap: spacing.l }}>
        <Text style={styles.hint}>
          名字行怎么排。两种样式都显示同样的信息，区别只是「服务器和世界」是收起来还是常驻。
        </Text>

        <Option
          mode="classic"
          title="经典（默认）"
          desc="名字行只有队伍；点一下头像展开服务器和世界，再点一下收起。同时只展开一条。"
        >
          <MessageGroup
            row={row}
            prefs={{ ...prefs, styleMode: 'classic' }}
            maxBubbleWidth={maxBubbleWidth}
            me=""
            expanded={false}
          />
          <View style={styles.previewDivider} />
          <MessageGroup
            row={{ ...row, key: 'style-preview-open' }}
            prefs={{ ...prefs, styleMode: 'classic' }}
            maxBubbleWidth={maxBubbleWidth}
            me=""
            expanded={expanded}
            onToggleExpand={() => setExpanded((v) => !v)}
          />
          <Text style={styles.previewHint}>上面是收起，下面是展开（点这个头像试试）</Text>
        </Option>

        <Option
          mode="pills"
          title="标签常驻"
          desc="名字在最前，队伍 / 服务器 / 世界三个标签跟在后面，一直显示，不用点。"
        >
          <MessageGroup
            row={row}
            prefs={{ ...prefs, styleMode: 'pills' }}
            maxBubbleWidth={maxBubbleWidth}
            me=""
          />
        </Option>

        <View style={styles.legend}>
          <View style={styles.legendRow}>
            <Ionicons name="people-outline" size={13} color={colors.textDim} />
            <Text style={styles.legendText}>队伍 —— 颜色跟 ServerUtilities 配的队伍色走，玩家名同色</Text>
          </View>
          <View style={styles.legendRow}>
            <Ionicons name="earth-outline" size={13} color={prefs.serverColor} />
            <Text style={styles.legendText}>
              服务器 —— 跨服消息用这个颜色（在「聊天外观」里配，默认橙色），本服消息是灰色
            </Text>
          </View>
          <View style={styles.legendRow}>
            <Ionicons name="map-outline" size={13} color={prefs.worldColor} />
            <Text style={styles.legendText}>世界 —— 颜色在「聊天外观」里配，默认绿色</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 18, marginLeft: spacing.xs },
  option: {
    borderWidth: 1,
    borderRadius: radius.l,
    padding: spacing.m,
    gap: spacing.s,
  },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  optionTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  optionDesc: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 2 },
  previewBox: {
    borderRadius: radius.m,
    borderWidth: 1,
    paddingVertical: spacing.m,
    overflow: 'hidden',
  },
  previewDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.s },
  previewHint: { color: colors.textFaint, fontSize: 10, marginTop: spacing.s, marginLeft: spacing.m },
  legend: { gap: spacing.s, marginTop: spacing.s, paddingHorizontal: spacing.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  legendText: { color: colors.textFaint, fontSize: 11, flexShrink: 1 },
}));
