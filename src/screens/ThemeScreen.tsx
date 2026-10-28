// 主题：深色 / 浅色 / 自定义。自定义只调四个基础色，其余由它们推导，改完立刻全界面生效。
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DARK,
  DARK_CUSTOM,
  LIGHT,
  LIGHT_CUSTOM,
  Palette,
  ThemeMode,
  CustomColors,
  autoPair,
  contrastRatio,
  derivePalette,
  isDarkColor,
  isHexColor,
  themedStyles,
  useTheme,
  spacing,
  radius,
} from '../theme';
import { GhostButton } from '../components';

const PRESETS = [
  '#0B0E14', '#141821', '#1F2937', '#000000',
  '#FFFFFF', '#F2F5F9', '#E8EDF4', '#D5DDE8',
  '#22D3EE', '#0E7490', '#A78BFA', '#6D28D9',
  '#34D399', '#FBBF24', '#F87171', '#E8ECF3',
];

/** 模式卡片里的小色板：用真实色板画两条「文字」和两个色块 */
function MiniPreview({ palette }: { palette: Palette }) {
  return (
    <View style={{ backgroundColor: palette.bg, borderRadius: radius.s, padding: 7, gap: 4, height: 52, justifyContent: 'center' }}>
      <View style={{ height: 6, width: '72%', borderRadius: 3, backgroundColor: palette.text }} />
      <View style={{ height: 4, width: '46%', borderRadius: 2, backgroundColor: palette.textDim }} />
      <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
        <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: palette.accent }} />
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 4,
            backgroundColor: palette.surface,
            borderWidth: 1,
            borderColor: palette.border,
          }}
        />
        <View style={{ flex: 1, height: 12, borderRadius: 4, backgroundColor: palette.surfaceAlt }} />
      </View>
    </View>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { colors } = useTheme();
  const [text, setText] = useState(value);
  // 外部（预设按钮 / 切模式）改了颜色时同步输入框
  useEffect(() => setText(value), [value]);

  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.hexWrap}>
          <View style={[styles.hexDot, { backgroundColor: value, borderColor: colors.border }]} />
          <TextInput
            style={styles.hexInput}
            value={text}
            onChangeText={(v) => {
              setText(v);
              const s = v.startsWith('#') ? v : `#${v}`;
              if (isHexColor(s)) onChange(s.toUpperCase());
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            selectTextOnFocus
          />
        </View>
      </View>
      <View style={styles.swatches}>
        {PRESETS.map((c) => {
          const on = value.toLowerCase() === c.toLowerCase();
          return (
            <TouchableOpacity
              key={c}
              onPress={() => onChange(c)}
              style={[
                styles.swatch,
                { backgroundColor: c, borderColor: colors.border },
                on && { borderColor: colors.accent, borderWidth: 2 },
              ]}
            />
          );
        })}
      </View>
      <Text style={styles.fieldHint}>{hint}</Text>
    </View>
  );
}

export default function ThemeScreen() {
  const { colors, mode, custom, setMode, setCustom, usePreset } = useTheme();

  const modePalette: Record<ThemeMode, Palette> = {
    dark: DARK,
    light: LIGHT,
    custom: derivePalette(custom),
  };

  const MODES: { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'dark', label: '深色', icon: 'moon' },
    { key: 'light', label: '浅色', icon: 'sunny' },
    { key: 'custom', label: '自定义', icon: 'color-palette' },
  ];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl, gap: spacing.l }}>
        {/* 模式 */}
        <View>
          <Text style={styles.groupTitle}>外观</Text>
          <View style={styles.modeRow}>
            {MODES.map((m) => {
              const on = mode === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.modeCard, on && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
                  onPress={() => setMode(m.key)}
                  activeOpacity={0.8}
                >
                  <MiniPreview palette={modePalette[m.key]} />
                  <View style={styles.modeFoot}>
                    <Ionicons name={m.icon} size={13} color={on ? colors.accent : colors.textDim} />
                    <Text style={[styles.modeLabel, on && { color: colors.accent }]}>{m.label}</Text>
                    {on ? <Ionicons name="checkmark-circle" size={14} color={colors.accent} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.footnote}>
            {mode === 'custom'
              ? '自定义：下面四个颜色改了立刻生效，其余颜色（卡片描边、次要文字、成功/警告）自动推导。'
              : mode === 'dark'
              ? '深色：默认外观，适合夜间和长时间看库存。'
              : '浅色：白天户外更清楚，图标和文字会自动加深保证对比度。'}
          </Text>
        </View>

        {/* 自定义颜色 */}
        {mode === 'custom' ? (
          <View>
            <Text style={styles.groupTitle}>自定义颜色</Text>
            <View style={styles.card}>
              <ColorField
                label="界面背景"
                hint="整个 App 的底色；深浅翻转时卡片和文字会自动跟着换，免得看不清"
                value={custom.bg}
                onChange={(v) => {
                  // 深底↔浅底 时把卡片/文字一起换掉：否则很容易配出「浅底浅字」这种看不见的界面
                  if (isDarkColor(v) !== isDarkColor(custom.bg)) {
                    const pair = autoPair(v, custom.accent);
                    setCustom({ bg: v, card: pair.card, text: pair.text, accent: pair.accent });
                  } else {
                    setCustom({ bg: v });
                  }
                }}
              />
              <View style={styles.divider} />
              <ColorField
                label="卡片"
                hint="列表格子、设置分组、输入框的底色"
                value={custom.card}
                onChange={(v) => setCustom({ card: v })}
              />
              <View style={styles.divider} />
              <ColorField
                label="文字"
                hint="主要文字颜色，次要文字由它和背景混出来"
                value={custom.text}
                onChange={(v) => setCustom({ text: v })}
              />
              <View style={styles.divider} />
              <ColorField
                label="强调色"
                hint="按钮、选中态、可合成标记；副强调色由它转 40° 色相得到"
                value={custom.accent}
                onChange={(v) => setCustom({ accent: v })}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.s, marginTop: spacing.s }}>
              <View style={{ flex: 1 }}>
                <GhostButton label="从深色开始" icon="moon" onPress={() => usePreset(DARK_CUSTOM)} />
              </View>
              <View style={{ flex: 1 }}>
                <GhostButton label="从浅色开始" icon="sunny" onPress={() => usePreset(LIGHT_CUSTOM)} />
              </View>
            </View>
            <View style={{ marginTop: spacing.s }}>
              <GhostButton
                label="按背景色自动配卡片与文字"
                icon="color-wand"
                onPress={() => usePreset(autoPair(custom.bg, custom.accent))}
              />
            </View>
          </View>
        ) : null}

        {/* 预览 */}
        <View>
          <Text style={styles.groupTitle}>预览</Text>
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
              <View style={styles.previewIcon}>
                <Ionicons name="cube" size={18} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle}>闪锌矿粉</Text>
                <Text style={styles.previewSub}>gregtech:gt.metaitem.01:2052 · 5.20T</Text>
              </View>
              <View style={styles.previewChip}>
                <Ionicons name="hammer" size={11} color={colors.accent} />
                <Text style={styles.previewChipText}>可合成</Text>
              </View>
            </View>

            <View style={styles.previewInput}>
              <Ionicons name="search" size={15} color={colors.textFaint} />
              <Text style={styles.previewInputText}>搜索物品名称…</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.s }}>
              <View style={[styles.previewBtn, { backgroundColor: colors.accent }]}>
                <Text style={[styles.previewBtnText, { color: colors.isDark ? colors.bg : '#FFFFFF' }]}>生成合成计划</Text>
              </View>
              <View style={[styles.previewBtn, { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }]}>
                <Text style={[styles.previewBtnText, { color: colors.textDim }]}>取消</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.s }}>
              <View style={[styles.previewTag, { backgroundColor: colors.okSoft }]}>
                <Text style={[styles.previewTagText, { color: colors.ok }]}>在线</Text>
              </View>
              <View style={[styles.previewTag, { backgroundColor: colors.warnSoft }]}>
                <Text style={[styles.previewTagText, { color: colors.warn }]}>离线缓存</Text>
              </View>
              <View style={[styles.previewTag, { backgroundColor: colors.badSoft }]}>
                <Text style={[styles.previewTagText, { color: colors.bad }]}>连接失败</Text>
              </View>
            </View>
          </View>
          <Text style={styles.footnote}>这是按当前配色渲染的真实组件样式，切主题时它会跟着变。</Text>
          {mode === 'custom' && contrastRatio(custom.text, custom.bg) < 3 ? (
            <View style={styles.warnRow}>
              <Ionicons name="warning-outline" size={13} color={colors.warn} />
              <Text style={styles.warnText}>
                文字和背景太接近，可能看不清（对比度 {contrastRatio(custom.text, custom.bg).toFixed(1)}）。
                可以点上面的「按背景色自动配卡片与文字」。
              </Text>
            </View>
          ) : null}
        </View>
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
  modeRow: { flexDirection: 'row', gap: spacing.s },
  modeCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    gap: 6,
  },
  modeFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  modeLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.m,
    gap: spacing.m,
  },
  divider: { height: 1, backgroundColor: colors.border },
  field: { gap: spacing.s },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  hexWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  hexDot: { width: 14, height: 14, borderRadius: 4, borderWidth: 1 },
  hexInput: { color: colors.text, fontSize: 12, fontWeight: '700', minWidth: 62, padding: 0 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  swatch: { width: 26, height: 26, borderRadius: 7, borderWidth: 1 },
  fieldHint: { color: colors.textFaint, fontSize: 11, lineHeight: 15 },
  footnote: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: spacing.s, marginLeft: spacing.xs },

  previewIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.s,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  previewSub: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
  previewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  previewChipText: { color: colors.accent, fontSize: 10, fontWeight: '700' },
  previewInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.m,
    paddingVertical: 10,
  },
  previewInputText: { color: colors.textFaint, fontSize: 13 },
  previewBtn: { flex: 1, borderRadius: radius.m, paddingVertical: 11, alignItems: 'center' },
  previewBtnText: { fontSize: 13, fontWeight: '700' },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: spacing.s, marginLeft: spacing.xs },
  warnText: { color: colors.warn, fontSize: 11, lineHeight: 16, flex: 1 },
  previewTag: { borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 3 },
  previewTagText: { fontSize: 10, fontWeight: '700' },
}));
