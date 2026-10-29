// 共享 UI 基础组件
import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { barrier } from './assets';
import { themedStyles, useTheme, radius, spacing, card } from './theme';

export function StatusDot({ ok, size = 8 }: { ok: boolean; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: ok ? colors.ok : colors.bad,
        shadowColor: ok ? colors.ok : colors.bad,
        shadowOpacity: 0.9,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 0 },
        elevation: 2,
      }}
    />
  );
}

export function Chip({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: 'neutral' | 'ok' | 'bad' | 'warn' | 'accent' | 'accent2';
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { colors } = useTheme();
  const bg = { neutral: colors.surfaceAlt, ok: colors.okSoft, bad: colors.badSoft, warn: colors.warnSoft, accent: colors.accentSoft, accent2: colors.accent2Soft }[tone];
  const fg = { neutral: colors.textDim, ok: colors.ok, bad: colors.bad, warn: colors.warn, accent: colors.accent, accent2: colors.accent2 }[tone];
  return (
    <View style={[chipStyles.wrap, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : null}
      <Text style={[chipStyles.text, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (k: T) => void;
  /** 宽度之类的覆盖。**不要在它外面再套一个 View 控制宽度** —— 包裹层的高度可能是 0，
   *  看着正常但点不动（监控页 2026-10-30 真机踩到）。 */
  style?: any;
}) {
  return (
    <View style={[segStyles.wrap, style]}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <TouchableOpacity key={o.key} style={[segStyles.item, active && segStyles.active]} onPress={() => onChange(o.key)}>
            <Text style={[segStyles.text, active && segStyles.activeText]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function ProgressBar({ ratio, tone, height = 6 }: { ratio: number; tone?: string; height?: number }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <View style={[barStyles.track, { height }]}>
      <View style={[barStyles.fill, { width: `${pct * 100}%`, backgroundColor: tone ?? colors.accent }]} />
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[card, { padding: spacing.l }, style]}>{children}</View>;
}

export function EmptyState({ icon, title, subtitle }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <View style={emptyStyles.wrap}>
      <Ionicons name={icon} size={52} color={colors.textFaint} />
      <Text style={emptyStyles.title}>{title}</Text>
      {subtitle ? <Text style={emptyStyles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function CenterLoading({ text }: { text?: string }) {
  const { colors } = useTheme();
  return (
    <View style={emptyStyles.wrap}>
      <ActivityIndicator color={colors.accent} size="large" />
      {text ? <Text style={emptyStyles.subtitle}>{text}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'accent',
  loading,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'accent' | 'bad';
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { colors } = useTheme();
  const bg = tone === 'accent' ? colors.accent : colors.bad;
  return (
    <TouchableOpacity
      disabled={disabled || loading}
      onPress={onPress}
      style={[btnStyles.wrap, { backgroundColor: bg, opacity: disabled && !loading ? 0.4 : 1 }]}
    >
      {loading ? <ActivityIndicator color={colors.bg} /> : <Ionicons name={icon ?? 'chevron-forward'} size={18} color={colors.bg} />}
      <Text style={btnStyles.text}>{label}</Text>
    </TouchableOpacity>
  );
}

export function GhostButton({
  label,
  onPress,
  disabled,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[btnStyles.ghost, { opacity: disabled ? 0.4 : 1 }]}>
      {icon ? <Ionicons name={icon} size={16} color={colors.textDim} /> : null}
      <Text style={btnStyles.ghostText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function StyledInput({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secure,
  right,
  multiline,
  autoCorrect = false,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'number-pad';
  secure?: boolean;
  right?: React.ReactNode;
  multiline?: boolean;
  autoCorrect?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={inputStyles.wrap}>
      <TextInput
        style={[inputStyles.input, multiline && { minHeight: 60, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={autoCorrect}
        multiline={multiline}
      />
      {right}
    </View>
  );
}

/**
 * data URI 的 source 对象缓存。
 *
 * RN 的 `<Image source={{uri}}>` 每次 render 都新建对象时，会重新走一遍图片解析；
 * 同一个 base64 反复包装成新对象，在滚动时是白白的开销。按 base64 串缓存住即可。
 */
const uriSourceCache = new Map<string, { uri: string }>();
function sourceOf(base64: string): { uri: string } {
  const hit = uriSourceCache.get(base64);
  if (hit) return hit;
  const src = { uri: `data:image/png;base64,${base64}` };
  // 400 条约 1.3MB：一屏最多几十个格子，够用且不会和图标 LRU 抢内存
  if (uriSourceCache.size > 400) uriSourceCache.clear();
  uriSourceCache.set(base64, src);
  return src;
}

/**
 * 物品/流体/源质图标。
 *
 * `uri` 来自 db.ts 的惰性 getter —— 只有这个组件被真正渲染时才会去查库。
 * 用 React.memo 包住：列表滚动/父组件状态变化时，props 没变就不重新渲染。
 */
export const ItemIcon = React.memo(function ItemIcon({
  uri,
  size = 40,
  fluid = false,
  fluidColor,
  tint,
}: {
  uri: string | null;
  size?: number;
  fluid?: boolean;
  /** 0xRRGGBB：流体用纯色方块 + 水滴，和游戏里 AE 终端一致 */
  fluidColor?: number | null;
  /** 给白色蒙版贴图上色（源质图标就是这种） */
  tint?: string | null;
}) {
  const { colors } = useTheme();
  if (!uri && fluid) {
    const rgb = fluidColor != null ? fluidColor & 0xffffff : null;
    const hex = rgb != null ? `#${rgb.toString(16).padStart(6, '0')}` : null;
    // 浅色流体（GT 很多流体是白色）配深色水滴，否则图标糊成一片
    const lum = rgb != null ? (0.299 * ((rgb >> 16) & 0xff) + 0.587 * ((rgb >> 8) & 0xff) + 0.114 * (rgb & 0xff)) / 255 : 0;
    const glyph = rgb == null ? colors.accent : lum > 0.62 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.92)';
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius.s,
          backgroundColor: hex ?? colors.accentSoft,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.12)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="water" size={size * 0.55} color={glyph} />
      </View>
    );
  }
  return (
    <Image
      source={uri ? sourceOf(uri) : barrier}
      style={{ width: size, height: size, borderRadius: radius.s, tintColor: tint ?? undefined }}
      resizeMode="contain"
    />
  );
});

export function FieldLabel({ text }: { text: string }) {
  const { colors } = useTheme();
  return <Text style={{ color: colors.textDim, fontSize: 12, marginBottom: spacing.s, marginTop: spacing.m }}>{text}</Text>;
}

/** 设置页分组：标题 + 一张卡片，卡片内由若干 SettingsRow 组成 */
export function SettingsGroup({ title, footnote, children }: { title?: string; footnote?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.l }}>
      {title ? <Text style={groupStyles.title}>{title}</Text> : null}
      <View style={[card, { overflow: 'hidden' }]}>{children}</View>
      {footnote ? <Text style={groupStyles.footnote}>{footnote}</Text> : null}
    </View>
  );
}

/** 设置项行：图标 + 标题/副标题 + 右侧值或自定义元素；有 onPress 时显示箭头 */
export function SettingsRow({
  icon,
  label,
  detail,
  value,
  onPress,
  right,
  tone = 'default',
  divider = true,
  disabled,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  detail?: string | null;
  value?: string | null;
  onPress?: () => void;
  right?: React.ReactNode;
  tone?: 'default' | 'bad';
  divider?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const body = (
    <View style={[groupStyles.row, divider && groupStyles.divider, disabled && { opacity: 0.45 }]}>
      {icon ? (
        <View style={[groupStyles.iconBox, tone === 'bad' && { backgroundColor: colors.badSoft }]}>
          <Ionicons name={icon} size={16} color={tone === 'bad' ? colors.bad : colors.accent} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[groupStyles.label, tone === 'bad' && { color: colors.bad }]} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text style={groupStyles.detail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={groupStyles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null)}
    </View>
  );
  if (!onPress) return body;
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.7}>
      {body}
    </TouchableOpacity>
  );
}

const chipStyles = themedStyles((colors) => ({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 11, fontWeight: '600' },
}));

const segStyles = themedStyles((colors) => ({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.m,
    padding: 3,
    gap: 2,
  },
  item: { flex: 1, paddingVertical: 7, borderRadius: radius.s, alignItems: 'center' },
  active: { backgroundColor: colors.surfaceHigh },
  text: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  activeText: { color: colors.accent },
}));

const barStyles = themedStyles((colors) => ({
  track: { backgroundColor: colors.surfaceHigh, borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.full },
}));

const emptyStyles = themedStyles((colors) => ({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.m, padding: spacing.xxl },
  title: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  subtitle: { color: colors.textFaint, fontSize: 13, textAlign: 'center' },
}));

const btnStyles = themedStyles((colors) => ({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    borderRadius: radius.m,
    paddingVertical: 13,
  },
  text: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  ghost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.m,
    paddingVertical: 12,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghostText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
}));

const inputStyles = themedStyles((colors) => ({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 },
}));

const groupStyles = themedStyles((colors) => ({
  title: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.s,
    marginLeft: spacing.xs,
  },
  footnote: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: spacing.s, marginLeft: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingHorizontal: spacing.m,
    paddingVertical: 13,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  detail: { color: colors.textFaint, fontSize: 11, marginTop: 2, lineHeight: 15 },
  value: { color: colors.textDim, fontSize: 13, maxWidth: 170, textAlign: 'right' },
}));
