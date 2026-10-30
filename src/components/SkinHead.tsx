// 头像：游戏内玩家的皮肤头部（本地裁剪 8×8 正面 + 帽子层）/ App 消息的字母默认头像。
//
// 不引入图片处理原生模块：把 64×64 皮肤按 size*8 放大，再用 overflow:hidden 的方框
// 把头部区域框出来。64×32 的老皮肤也能用 —— 头部像素坐标同样是 (8,8)，只是高度更短，
// 所以只给 width 不给 height，让 Image 自己保持原始比例。
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colorForName, invalidateAvatar, letterOf, useAvatar } from '../avatars';
import { skinCrop } from '../skincrop';
import { useTheme } from '../theme';

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
  const [skinWidth, setSkinWidth] = useState(64);
  const [failed, setFailed] = useState(false);

  const uri = failed ? null : av.uri;

  // 皮肤可能是 64×64 / 64×32 / 128×128；宽度按真实尺寸算，高度交给 Image 保持比例
  useEffect(() => {
    setFailed(false);
    if (!av.uri) {
      setSkinWidth(64);
      return;
    }
    let alive = true;
    Image.getSize(
      av.uri,
      (w) => {
        if (alive && w > 0) setSkinWidth(w);
      },
      () => {
        if (!alive) return;
        setFailed(true);
        invalidateAvatar(name);
      },
    );
    return () => {
      alive = false;
    };
  }, [av.uri, name]);

  const crop = skinCrop(size, skinWidth);
  if (size <= 0) return null;
  const radius = Math.max(5, Math.round(size * 0.2));

  const face = uri ? (
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
        source={{ uri }}
        fadeDuration={0}
        onError={() => {
          setFailed(true);
          invalidateAvatar(name);
        }}
        style={{
          position: 'absolute',
          width: crop.imageWidth,
          left: crop.left,
          top: crop.top,
        }}
      />
      {/* 上层：帽子 / 发型（透明区域不影响底层） */}
      <Image
        source={{ uri }}
        fadeDuration={0}
        onError={() => {
          setFailed(true);
          invalidateAvatar(name);
        }}
        style={{
          position: 'absolute',
          width: crop.imageWidth,
          left: crop.hatLeft,
          top: crop.top,
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
