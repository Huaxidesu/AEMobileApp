// 共享 UI 基础组件
import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { barrier } from './assets';
import { colors, radius, spacing, card } from './theme';

export function StatusDot({ ok, size = 8 }: { ok: boolean; size?: number }) {
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
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (k: T) => void;
}) {
  return (
    <View style={segStyles.wrap}>
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

export function ProgressBar({ ratio, tone = colors.accent, height = 6 }: { ratio: number; tone?: string; height?: number }) {
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <View style={[barStyles.track, { height }]}>
      <View style={[barStyles.fill, { width: `${pct * 100}%`, backgroundColor: tone }]} />
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[card, { padding: spacing.l }, style]}>{children}</View>;
}

export function EmptyState({ icon, title, subtitle }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string }) {
  return (
    <View style={emptyStyles.wrap}>
      <Ionicons name={icon} size={52} color={colors.textFaint} />
      <Text style={emptyStyles.title}>{title}</Text>
      {subtitle ? <Text style={emptyStyles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function CenterLoading({ text }: { text?: string }) {
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

export function ItemIcon({ uri, size = 40 }: { uri: string | null; size?: number }) {
  return (
    <Image
      source={uri ? { uri: `data:image/png;base64,${uri}` } : barrier}
      style={{ width: size, height: size, borderRadius: radius.s }}
      resizeMode="contain"
    />
  );
}

export function FieldLabel({ text }: { text: string }) {
  return <Text style={{ color: colors.textDim, fontSize: 12, marginBottom: spacing.s, marginTop: spacing.m }}>{text}</Text>;
}

const chipStyles = StyleSheet.create({
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
});

const segStyles = StyleSheet.create({
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
});

const barStyles = StyleSheet.create({
  track: { backgroundColor: colors.surfaceHigh, borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.full },
});

const emptyStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.m, padding: spacing.xxl },
  title: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  subtitle: { color: colors.textFaint, fontSize: 13, textAlign: 'center' },
});

const btnStyles = StyleSheet.create({
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
});

const inputStyles = StyleSheet.create({
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
});
