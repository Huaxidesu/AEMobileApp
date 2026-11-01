// 聊天外观：字号 / 头像大小 / 气泡宽度 / 消息间距 / 时间位置 / 进出提示 / 成就提示。
// 改完立刻生效，预览用聊天页同一套 MessageGroup 组件渲染。
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { themedStyles, useTheme, spacing, radius } from '../theme';
import { CHAT_LIMITS, useChatPrefs } from '../chatprefs';
import type { ChatDensity, ChatTimeMode } from '../chatprefs';
import { DayDivider, MessageGroup, SystemLine } from '../chatview';
import type { ChatRow } from '../chatgroup';
import { ColorField, GhostButton, Segmented } from '../components';
import { hasCap } from '../serverinfo';

type GroupRow = Extract<ChatRow, { type: 'group' }>;

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const { colors } = useTheme();
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <View style={styles.stepRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepLabel}>{label}</Text>
        <Text style={styles.stepHint}>{hint}</Text>
      </View>
      <View style={styles.stepper}>
        <TouchableOpacity
          style={[styles.stepBtn, atMin && styles.stepBtnOff]}
          disabled={atMin}
          onPress={() => onChange(Math.max(min, value - step))}
        >
          <Ionicons name="remove" size={17} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.stepValue}>
          {value}
          {suffix}
        </Text>
        <TouchableOpacity
          style={[styles.stepBtn, atMax && styles.stepBtnOff]}
          disabled={atMax}
          onPress={() => onChange(Math.min(max, value + step))}
        >
          <Ionicons name="add" size={17} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ChatAppearanceScreen() {
  const { colors } = useTheme();
  const {
    prefs,
    setFontSize,
    setAvatarSize,
    setBubbleMaxWidth,
    setDensity,
    setTimeMode,
    setShowJoinLeave,
    setShowAchievements,
    setServerColor,
    setWorldColor,
    reset,
  } = useChatPrefs();
  const win = useWindowDimensions();
  /** 预览里点一下头像就能看到 classic 样式的展开效果 */
  const [expanded, setExpanded] = useState(false);

  // 这台服实际能提供的标签能力（握手时服务端报的 caps）。
  // 没有的能力连预览里都不摆 —— 否则设置页会示范一个线上永远不会出现的样子。
  const canChat = hasCap('chat');
  const canTeam = hasCap('team');
  const canWorld = hasCap('world');

  const now = Date.now();
  const msg = (seq: number, kind: number, name: string, text: string, dt: number) => ({
    boot: 0,
    seq,
    kind,
    name,
    text,
    ts: now + dt,
  });
  const other: GroupRow = {
    type: 'group',
    key: 'preview-other',
    name: 'Steve',
    kind: 0,
    mine: false,
    team: canTeam ? '华溪岛' : undefined,
    teamColor: canTeam ? 'd' : undefined,
    world: canWorld ? '主世界' : undefined,
    msgs: [
      msg(1, 0, 'Steve', '§e晚上开荒§r，谁来？', -4 * 60000),
      msg(2, 0, 'Steve', '§b@我§r 缺个挖矿的', -3 * 60000),
    ],
  };
  const appOther: GroupRow = {
    type: 'group',
    key: 'preview-app',
    name: '手机老王',
    kind: 1,
    mine: false,
    srv: canChat ? '天空树' : undefined,
    world: canWorld ? '下界' : undefined,
    msgs: [msg(3, 1, '手机老王', '我在外面，先用手机跟一句', -2 * 60000)],
  };
  const mineRow: GroupRow = {
    type: 'group',
    key: 'preview-mine',
    name: '我',
    kind: 1,
    mine: true,
    msgs: [msg(4, 1, '我', '等我十分钟，马上到', -60000)],
  };

  // 预览卡片左右各有内边距，按实际可用宽度换算气泡上限，避免撑破卡片
  const previewWidth = Math.max(180, win.width - spacing.l * 2 - spacing.m * 2);
  const maxBubbleWidth = Math.round((previewWidth * prefs.bubbleMaxWidth) / 100);
  /** 头像只有固定几档，按选项下标步进 */
  const avatarIndex = Math.max(
    0,
    CHAT_LIMITS.avatarSize.options.findIndex((v) => v === prefs.avatarSize),
  );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl, gap: spacing.l }}>
        <View>
          <Text style={styles.groupTitle}>预览</Text>
          <View style={styles.previewCard}>
            <DayDivider label="今天" />
            {prefs.showJoinLeave ? <SystemLine msg={msg(5, 2, 'Alex', '', -5 * 60000)} variant="join" /> : null}
            {prefs.showAchievements ? (
              <SystemLine msg={msg(6, 6, 'Steve', '获得木头', -4.5 * 60000)} variant="achievement" />
            ) : null}
            <MessageGroup
              row={other}
              prefs={prefs}
              maxBubbleWidth={maxBubbleWidth}
              me="我"
              expanded={expanded}
              onToggleExpand={() => setExpanded((v) => !v)}
            />
            <MessageGroup row={appOther} prefs={prefs} maxBubbleWidth={maxBubbleWidth} me="我" />
            <MessageGroup row={mineRow} prefs={prefs} maxBubbleWidth={maxBubbleWidth} me="我" />
          </View>
          <Text style={styles.footnote}>
            预览与聊天页使用同一套组件。头像只在游戏内玩家的第一条消息旁显示，连续发言会并成一组；
            点一下预览里的头像可以展开服务器和世界标签。
          </Text>
        </View>

        <View>
          <Text style={styles.groupTitle}>标签颜色</Text>
          {canChat || canWorld ? (
            <View style={styles.card}>
              {canChat ? (
                <ColorField
                  label="服务器"
                  hint="地球图标、文字和描边同色；本服和跨服都用这个颜色"
                  value={prefs.serverColor}
                  onChange={setServerColor}
                />
              ) : null}
              {canChat && canWorld ? <View style={styles.divider} /> : null}
              {canWorld ? (
                <ColorField
                  label="世界"
                  hint="地图图标、文字和描边同色；默认绿色"
                  value={prefs.worldColor}
                  onChange={setWorldColor}
                />
              ) : null}
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.compatNote}>
                当前服务器未安装 GTNHChat，队伍 / 服务器 / 世界标签不可用，这里没有可配的颜色。
              </Text>
            </View>
          )}
          <Text style={styles.footnote}>
            队伍标签和玩家名跟着 ServerUtilities 里配的队伍颜色走，这里改不了；没队伍的玩家名字是白色。
          </Text>
        </View>

        <View>
          <Text style={styles.groupTitle}>气泡与文字</Text>
          <View style={styles.card}>
            <Stepper
              label="正文字号"
              hint={`${CHAT_LIMITS.fontSize.min}–${CHAT_LIMITS.fontSize.max} px，只影响聊天气泡里的内容`}
              value={prefs.fontSize}
              min={CHAT_LIMITS.fontSize.min}
              max={CHAT_LIMITS.fontSize.max}
              onChange={setFontSize}
            />
            <View style={styles.divider} />
            <Stepper
              label="气泡最大宽度"
              hint="占屏幕宽度的比例；长消息会自动换行"
              value={prefs.bubbleMaxWidth}
              min={CHAT_LIMITS.bubbleMaxWidth.min}
              max={CHAT_LIMITS.bubbleMaxWidth.max}
              step={2}
              suffix="%"
              onChange={setBubbleMaxWidth}
            />
            <View style={styles.divider} />
            <View style={{ paddingVertical: spacing.m, gap: spacing.s }}>
              <View>
                <Text style={styles.stepLabel}>消息间距</Text>
                <Text style={styles.stepHint}>紧凑适合刷屏服，宽松更接近 Telegram 默认</Text>
              </View>
              <Segmented
                options={[
                  { key: 'compact', label: '紧凑' },
                  { key: 'standard', label: '标准' },
                  { key: 'cozy', label: '宽松' },
                ]}
                value={prefs.density}
                onChange={(k) => setDensity(k as ChatDensity)}
              />
            </View>
            <View style={styles.divider} />
            <View style={{ paddingVertical: spacing.m, gap: spacing.s }}>
              <View>
                <Text style={styles.stepLabel}>时间显示</Text>
                <Text style={styles.stepHint}>气泡内：右下角小字；气泡上方：单独一行</Text>
              </View>
              <Segmented
                options={[
                  { key: 'inside', label: '气泡内' },
                  { key: 'above', label: '上方' },
                  { key: 'hidden', label: '隐藏' },
                ]}
                value={prefs.timeMode}
                onChange={(k) => setTimeMode(k as ChatTimeMode)}
              />
            </View>
          </View>
        </View>

        <View>
          <Text style={styles.groupTitle}>头像</Text>
          <View style={styles.card}>
            <View style={styles.stepRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepLabel}>头像大小</Text>
                <Text style={styles.stepHint}>隐藏 / 24 / 32 / 40 / 48；游戏内玩家用皮肤，App 消息用默认头像</Text>
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={[styles.stepBtn, avatarIndex <= 0 && styles.stepBtnOff]}
                  disabled={avatarIndex <= 0}
                  onPress={() => setAvatarSize(CHAT_LIMITS.avatarSize.options[avatarIndex - 1])}
                >
                  <Ionicons name="remove" size={17} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.stepValue}>{prefs.avatarSize === 0 ? '隐藏' : prefs.avatarSize}</Text>
                <TouchableOpacity
                  style={[
                    styles.stepBtn,
                    avatarIndex >= CHAT_LIMITS.avatarSize.options.length - 1 && styles.stepBtnOff,
                  ]}
                  disabled={avatarIndex >= CHAT_LIMITS.avatarSize.options.length - 1}
                  onPress={() => setAvatarSize(CHAT_LIMITS.avatarSize.options[avatarIndex + 1])}
                >
                  <Ionicons name="add" size={17} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepLabel}>玩家进出提示</Text>
                <Text style={styles.stepHint}>以居中灰色系统行显示，不计入未读</Text>
              </View>
              <Switch
                value={prefs.showJoinLeave}
                onValueChange={setShowJoinLeave}
                trackColor={{ false: colors.surfaceHigh, true: colors.accent }}
                thumbColor={prefs.showJoinLeave ? colors.bg : colors.textDim}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepLabel}>成就提示</Text>
                <Text style={styles.stepHint}>玩家完成成就时，像进出一样显示居中系统行</Text>
              </View>
              <Switch
                value={prefs.showAchievements}
                onValueChange={setShowAchievements}
                trackColor={{ false: colors.surfaceHigh, true: colors.accent }}
                thumbColor={prefs.showAchievements ? colors.bg : colors.textDim}
              />
            </View>
          </View>
        </View>

        <GhostButton label="恢复默认（14px · 32 头像 · 82% · 标准）" icon="refresh" onPress={reset} />
      </ScrollView>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  groupTitle: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.s,
    marginLeft: spacing.xs,
  },
  previewCard: {
    backgroundColor: colors.bg,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.m,
    paddingHorizontal: spacing.m,
  },
  footnote: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: spacing.s, marginLeft: spacing.xs },
  /** 服务端没这项能力时的说明（代替整块设置项，不留点了没反应的入口） */
  compatNote: { color: colors.textDim, fontSize: 12, lineHeight: 18, paddingVertical: spacing.s, paddingHorizontal: spacing.m },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.m,
  },
  divider: { height: 1, backgroundColor: colors.border },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, paddingVertical: spacing.m },
  stepLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  stepHint: { color: colors.textFaint, fontSize: 11, marginTop: 2, lineHeight: 15 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  stepBtnOff: { opacity: 0.35 },
  stepValue: { color: colors.text, fontSize: 16, fontWeight: '800', minWidth: 42, textAlign: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, paddingVertical: spacing.m },
}));
