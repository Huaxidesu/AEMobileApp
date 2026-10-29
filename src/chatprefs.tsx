// 聊天页外观偏好：字号、头像大小、气泡宽度、消息间距、时间位置、进出提示开关。
// 和主题/网格一样存 SecureStore，改完立刻生效；聊天页和设置页预览共用。
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

export type ChatDensity = 'compact' | 'standard' | 'cozy';
export type ChatTimeMode = 'inside' | 'above' | 'hidden';

export interface ChatPrefs {
  /** 正文字号 */
  fontSize: number;
  /** 头像边长；0 = 不显示 */
  avatarSize: number;
  /** 气泡最大宽度（占屏幕宽度百分比） */
  bubbleMaxWidth: number;
  density: ChatDensity;
  timeMode: ChatTimeMode;
  /** 是否显示玩家加入/退出提示 */
  showJoinLeave: boolean;
}

export const CHAT_LIMITS = {
  fontSize: { min: 12, max: 20 },
  avatarSize: { options: [0, 24, 32, 40, 48] },
  bubbleMaxWidth: { min: 60, max: 92 },
};

export const DEFAULT_CHAT: ChatPrefs = {
  fontSize: 14,
  avatarSize: 32,
  bubbleMaxWidth: 82,
  density: 'standard',
  timeMode: 'inside',
  showJoinLeave: true,
};

/** 三档密度对应的尺寸（页面上只说「紧凑/标准/宽松」） */
export const DENSITY = {
  compact: { rowGap: 3, groupGap: 9, padH: 10, padV: 5, innerGap: 2 },
  standard: { rowGap: 6, groupGap: 14, padH: 12, padV: 7, innerGap: 3 },
  cozy: { rowGap: 10, groupGap: 20, padH: 14, padV: 10, innerGap: 5 },
};

const KEY = 'ui.chat';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalize(p: Partial<ChatPrefs> | null | undefined): ChatPrefs {
  const fontSize = Number(p?.fontSize);
  const avatarSize = Number(p?.avatarSize);
  const bubble = Number(p?.bubbleMaxWidth);
  const density: ChatDensity =
    p?.density === 'compact' || p?.density === 'cozy' ? p.density : 'standard';
  const timeMode: ChatTimeMode =
    p?.timeMode === 'above' || p?.timeMode === 'hidden' ? p.timeMode : 'inside';
  return {
    fontSize: Number.isFinite(fontSize) ? clamp(fontSize, 12, 20) : DEFAULT_CHAT.fontSize,
    avatarSize: CHAT_LIMITS.avatarSize.options.includes(avatarSize) ? avatarSize : DEFAULT_CHAT.avatarSize,
    bubbleMaxWidth: Number.isFinite(bubble) ? clamp(bubble, 60, 92) : DEFAULT_CHAT.bubbleMaxWidth,
    density,
    timeMode,
    showJoinLeave: p?.showJoinLeave !== false,
  };
}

function load(): ChatPrefs {
  try {
    const raw = SecureStore.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : DEFAULT_CHAT;
  } catch {
    return DEFAULT_CHAT;
  }
}

interface ChatPrefsCtx {
  prefs: ChatPrefs;
  setFontSize: (n: number) => void;
  setAvatarSize: (n: number) => void;
  setBubbleMaxWidth: (n: number) => void;
  setDensity: (d: ChatDensity) => void;
  setTimeMode: (m: ChatTimeMode) => void;
  setShowJoinLeave: (v: boolean) => void;
  reset: () => void;
}

const Ctx = createContext<ChatPrefsCtx | null>(null);

export function ChatPrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<ChatPrefs>(load);

  const update = useCallback((next: ChatPrefs) => {
    const clean = normalize(next);
    setPrefs(clean);
    try {
      SecureStore.setItem(KEY, JSON.stringify(clean));
    } catch {
      // 存不下就只在本次运行里生效
    }
  }, []);

  const value = useMemo<ChatPrefsCtx>(
    () => ({
      prefs,
      setFontSize: (n) => update({ ...prefs, fontSize: n }),
      setAvatarSize: (n) => update({ ...prefs, avatarSize: n }),
      setBubbleMaxWidth: (n) => update({ ...prefs, bubbleMaxWidth: n }),
      setDensity: (d) => update({ ...prefs, density: d }),
      setTimeMode: (m) => update({ ...prefs, timeMode: m }),
      setShowJoinLeave: (v) => update({ ...prefs, showJoinLeave: v }),
      reset: () => update(DEFAULT_CHAT),
    }),
    [prefs, update],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChatPrefs(): ChatPrefsCtx {
  const ctx = useContext(Ctx);
  return (
    ctx ?? {
      prefs: DEFAULT_CHAT,
      setFontSize: () => {},
      setAvatarSize: () => {},
      setBubbleMaxWidth: () => {},
      setDensity: () => {},
      setTimeMode: () => {},
      setShowJoinLeave: () => {},
      reset: () => {},
    }
  );
}
