// 设计令牌 + 主题：深色 / 浅色 / 自定义。
//
// 颜色在运行时可变，所以样式表不能是「模块加载时算好的一份常量」：
// 用 `themedStyles((colors) => ({...}))` 包一层，内部按主题版本号缓存，
// 主题一变下次取样式时自动重建。组件里再用 `useTheme()` 拿到当前色板并触发重渲染。
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export interface Palette {
  isDark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceHigh: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accent2: string;
  accentSoft: string;
  accent2Soft: string;
  ok: string;
  okSoft: string;
  warn: string;
  warnSoft: string;
  bad: string;
  badSoft: string;
}

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

// ---------------------------------------------------------------- 颜色工具

export function parseColor(input: string): [number, number, number] | null {
  const h = input.trim().replace(/^#/, '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export function isHexColor(input: string): boolean {
  return parseColor(input) != null;
}

export function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** 把 a 往 b 混 t（0 = 全 a，1 = 全 b） */
export function mix(a: string, b: string, t: number): string {
  const A = parseColor(a);
  const B = parseColor(b);
  if (!A || !B) return a;
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

/** 半透明版本：`rgba(...)`，用于 accentSoft / okSoft 这类底色 */
export function alpha(color: string, a: number): string {
  const c = parseColor(color);
  if (!c) return color;
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/** 相对亮度 0–1，用来判断底色是深还是浅 */
export function luminance(color: string): number {
  const c = parseColor(color);
  if (!c) return 0;
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

export function isDarkColor(color: string): boolean {
  return luminance(color) < 0.5;
}

/** 色相旋转，用来从强调色推出副强调色 */
export function rotateHue(color: string, deg: number): string {
  const c = parseColor(color);
  if (!c) return color;
  const [r, g, b] = c.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  h = (h + deg / 360 + 1) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const to = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return toHex(to(h + 1 / 3) * 255, to(h) * 255, to(h - 1 / 3) * 255);
}

// ---------------------------------------------------------------- 三套色板

/** 玩家能自己调的四个颜色，其余由它们推导 */
export interface CustomColors {
  bg: string;
  card: string;
  text: string;
  accent: string;
}

export type ThemeMode = 'dark' | 'light' | 'custom';

export const DARK: Palette = {
  isDark: true,
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

export const LIGHT: Palette = {
  isDark: false,
  bg: '#F2F5F9',
  surface: '#FFFFFF',
  surfaceAlt: '#E9EEF5',
  surfaceHigh: '#DCE3ED',
  border: '#D5DDE8',
  text: '#111827',
  textDim: '#4A5568',
  textFaint: '#8592A6',
  accent: '#0E7490',
  accent2: '#6D28D9',
  accentSoft: 'rgba(14,116,144,0.12)',
  accent2Soft: 'rgba(109,40,217,0.12)',
  ok: '#047857',
  okSoft: 'rgba(4,120,87,0.12)',
  warn: '#B45309',
  warnSoft: 'rgba(180,83,9,0.12)',
  bad: '#DC2626',
  badSoft: 'rgba(220,38,38,0.12)',
};

/** 自定义色板的默认起点（就是深色主题） */
export const DARK_CUSTOM: CustomColors = { bg: DARK.bg, card: DARK.surface, text: DARK.text, accent: DARK.accent };
export const LIGHT_CUSTOM: CustomColors = { bg: LIGHT.bg, card: LIGHT.surface, text: LIGHT.text, accent: LIGHT.accent };

/** 文字与背景的对比度（粗略版，够用来提示「看不清」） */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** 只给一个背景色，自动配出卡片 / 文字 / 强调色（换底色时一键救回可读性） */
export function autoPair(bg: string, accent?: string): CustomColors {
  const dark = isDarkColor(bg);
  let accentColor = accent ?? (dark ? '#22D3EE' : '#0E7490');
  // 强调色在新底色上太浅（比如浅底 + 青色）就往对比方向压一档，否则图标和选中态看不清
  if (contrastRatio(accentColor, bg) < 2.2) {
    accentColor = mix(accentColor, dark ? '#FFFFFF' : '#000000', 0.45);
  }
  return {
    bg,
    card: mix(bg, dark ? '#FFFFFF' : '#000000', dark ? 0.07 : 0.035),
    text: dark ? '#E8ECF3' : '#111827',
    accent: accentColor,
  };
}

/** 用四个自选色推导出完整色板：其余颜色按「卡片与文字互混」算，深浅自动判断 */
export function derivePalette(c: CustomColors): Palette {
  const dark = isDarkColor(c.bg);
  const surface = c.card;
  const accent2 = rotateHue(c.accent, 40);
  const ok = dark ? '#34D399' : '#047857';
  const warn = dark ? '#FBBF24' : '#B45309';
  const bad = dark ? '#F87171' : '#DC2626';
  return {
    isDark: dark,
    bg: c.bg,
    surface,
    surfaceAlt: mix(surface, c.text, dark ? 0.07 : 0.05),
    surfaceHigh: mix(surface, c.text, dark ? 0.13 : 0.1),
    border: mix(surface, c.text, dark ? 0.17 : 0.14),
    text: c.text,
    textDim: mix(c.text, c.bg, dark ? 0.4 : 0.32),
    textFaint: mix(c.text, c.bg, dark ? 0.6 : 0.52),
    accent: c.accent,
    accent2,
    accentSoft: alpha(c.accent, dark ? 0.16 : 0.12),
    accent2Soft: alpha(accent2, dark ? 0.18 : 0.12),
    ok,
    okSoft: alpha(ok, 0.14),
    warn,
    warnSoft: alpha(warn, 0.14),
    bad,
    badSoft: alpha(bad, 0.14),
  };
}

// ---------------------------------------------------------------- 主题状态

/** 当前色板 + 版本号：themedStyles 靠它判断要不要重建 */
let current: Palette = DARK;
let rev = 0;

function applyPalette(p: Palette) {
  if (p === current) return;
  current = p;
  rev += 1;
  card = buildCard(p);
}

/**
 * 包一层样式表：`const styles = themedStyles((colors) => ({ ... }))`。
 * 写法与原来的 `StyleSheet.create({...})` 一样，只是颜色从参数里取，
 * 主题切换后第一次访问会自动用新色板重建。
 */
export function themedStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: Palette) => T & StyleSheet.NamedStyles<any>,
): T {
  let cache: T | null = null;
  let cachedRev = -1;
  return new Proxy({} as T, {
    get(_target, key) {
      if (!cache || cachedRev !== rev) {
        cache = StyleSheet.create(factory(current)) as T;
        cachedRev = rev;
      }
      return cache[key as keyof T];
    },
  });
}

function buildCard(p: Palette) {
  return { backgroundColor: p.surface, borderRadius: radius.l, borderWidth: 1, borderColor: p.border };
}

/** 卡片外观（直接用，不用进 styles） */
export let card: any = buildCard(DARK);

export function currentPalette(): Palette {
  return current;
}

// ---------------------------------------------------------------- Provider

const KEY = 'ui.theme';

interface ThemeState {
  mode: ThemeMode;
  custom: CustomColors;
}

function loadState(): ThemeState {
  try {
    const raw = SecureStore.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const mode: ThemeMode =
      parsed?.mode === 'light' || parsed?.mode === 'custom' || parsed?.mode === 'dark' ? parsed.mode : 'dark';
    const custom: CustomColors = {
      bg: isHexColor(parsed?.custom?.bg ?? '') ? parsed.custom.bg : DARK_CUSTOM.bg,
      card: isHexColor(parsed?.custom?.card ?? '') ? parsed.custom.card : DARK_CUSTOM.card,
      text: isHexColor(parsed?.custom?.text ?? '') ? parsed.custom.text : DARK_CUSTOM.text,
      accent: isHexColor(parsed?.custom?.accent ?? '') ? parsed.custom.accent : DARK_CUSTOM.accent,
    };
    return { mode, custom };
  } catch {
    return { mode: 'dark', custom: DARK_CUSTOM };
  }
}

interface ThemeCtx {
  mode: ThemeMode;
  colors: Palette;
  custom: CustomColors;
  setMode: (m: ThemeMode) => void;
  setCustom: (patch: Partial<CustomColors>) => void;
  usePreset: (preset: CustomColors) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ThemeState>(loadState);

  const colors = useMemo(() => {
    const p = state.mode === 'light' ? LIGHT : state.mode === 'custom' ? derivePalette(state.custom) : DARK;
    // 在子组件渲染前把全局色板换掉，themedStyles 下次取值就会重建
    applyPalette(p);
    return p;
  }, [state]);

  const persist = useCallback((next: ThemeState) => {
    setState(next);
    try {
      SecureStore.setItem(KEY, JSON.stringify(next));
    } catch {
      // 存不下就只在本次运行里生效
    }
  }, []);

  const value = useMemo<ThemeCtx>(
    () => ({
      mode: state.mode,
      colors,
      custom: state.custom,
      setMode: (mode) => persist({ ...state, mode }),
      setCustom: (patch) => persist({ ...state, custom: { ...state.custom, ...patch } }),
      usePreset: (preset) => persist({ mode: 'custom', custom: { ...preset } }),
    }),
    [state, colors, persist],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  // 理论上 Provider 一定在，兜底成深色，免得单测/预览环境直接崩
  return ctx ?? { mode: 'dark', colors: currentPalette(), custom: DARK_CUSTOM, setMode: () => {}, setCustom: () => {}, usePreset: () => {} };
}
