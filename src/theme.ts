// 设计令牌：暗色主题（GTNH/AE 科技感：青色主色 + 紫色点缀）
export const colors = {
  bg: '#0B0E14',
  surface: '#141821',
  surfaceAlt: '#1B2130',
  surfaceHigh: '#232B3D',
  border: '#232A38',
  text: '#E8ECF3',
  textDim: '#9AA4B8',
  textFaint: '#5C6577',
  accent: '#22D3EE',
  accent2: '#A78BFA',
  accentSoft: 'rgba(34,211,238,0.14)',
  accent2Soft: 'rgba(167,139,250,0.16)',
  ok: '#34D399',
  okSoft: 'rgba(52,211,153,0.14)',
  warn: '#FBBF24',
  warnSoft: 'rgba(251,191,36,0.14)',
  bad: '#F87171',
  badSoft: 'rgba(248,113,113,0.14)',
};

export const spacing = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  s: 8,
  m: 12,
  l: 16,
  full: 999,
};

export const type = {
  title: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 16, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 14, color: colors.text },
  caption: { fontSize: 12, color: colors.textDim },
  tiny: { fontSize: 10, color: colors.textFaint },
};

export const card = {
  backgroundColor: colors.surface,
  borderRadius: radius.l,
  borderWidth: 1,
  borderColor: colors.border,
} as const;
