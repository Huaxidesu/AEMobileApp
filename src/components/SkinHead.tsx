// 头像：游戏内玩家的皮肤头部（本地裁剪 8×8 正面 + 帽子层）/ App 消息的字母默认头像。
//
// 不引入图片处理原生模块：把 64×64 皮肤按 size*8 放大，再用 overflow:hidden 的方框
// 把头部区域框出来。64×32 的老皮肤也能用 —— 头部像素坐标同样是 (8,8)，只是高度更短，
// 所以只给 width 不给 height，让 Image 自己保持原始比例。
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colorForName, letterOf, useAvatar } from '../avatars';
import { useTheme } from '../theme';

const HEAD_OFFSET = 8; // 头部正面在皮肤图里的左上角
const HAT_OFFSET = 40; // 帽子层在皮肤图里的左上角
const SKIN_SCALE = 8; // 64 → size*8

export function SkinHead({
  name,
  size,
  kind,
  badge = false,
}: {
  name?: string | null;
  size: number;
  /** 0/2/3 才解析皮肤；1（App）或未给时直接用默认头像 */
  kind?: number;
  /** 右下角小手机角标（App 消息用） */
  badge?: boolean;
}) {
  const game = kind === 0 || kind === 2 || kind === 3;
  const av = useAvatar(name, game);
  if (size <= 0) return null;
  const radius = Math.max(5, Math.round(size * 0.2));

  const face = av.uri ? (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: '#00000022',
      }}
    >
      {/* 底层：头部正面 */}
      <Image
        source={{ uri: av.uri }}
        fadeDuration={0}
        style={{
          position: 'absolute',
          width: size * SKIN_SCALE,
          left: -HEAD_OFFSET * size,
          top: -HEAD_OFFSET * size,
        }}
      />
      {/* 上层：帽子 / 发型（透明区域不影响底层） */}
      <Image
        source={{ uri: av.uri }}
        fadeDuration={0}
        style={{
          position: 'absolute',
          width: size * SKIN_SCALE,
          left: -HAT_OFFSET * size,
          top: -HEAD_OFFSET * size,
        }}
      />
    </View>
  ) : (
    <LetterAvatar name={name} size={size} />
  );

  if (!badge) return face;
  return (
    <View style={{ width: size, height: size }}>
      {face}
      <PhoneBadge size={size} />
    </View>
  );
}

/** 默认头像：昵称首字 + 按名字哈希的稳定底色；没名字时用人形图标 */
export function LetterAvatar({ name, size }: { name?: string | null; size: number }) {
  const { colors } = useTheme();
  const hasName = !!name && name.trim().length > 0;
  const bg = hasName ? colorForName(name) : colors.surfaceHigh;
  const radius = Math.max(5, Math.round(size * 0.2));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {hasName ? (
        <Text
          style={{
            color: '#FFFFFF',
            fontSize: Math.round(size * 0.44),
            fontWeight: '800',
            includeFontPadding: false,
          }}
        >
          {letterOf(name)}
        </Text>
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.54)} color={colors.textFaint} />
      )}
    </View>
  );
}

function PhoneBadge({ size }: { size: number }) {
  const { colors } = useTheme();
  const s = Math.max(12, Math.round(size * 0.38));
  return (
    <View
      style={{
        position: 'absolute',
        right: -Math.round(s * 0.18),
        bottom: -Math.round(s * 0.18),
        width: s,
        height: s,
        borderRadius: s / 2,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.surface,
      }}
    >
      <Ionicons name="phone-portrait" size={Math.round(s * 0.6)} color={colors.bg} />
    </View>
  );
}
