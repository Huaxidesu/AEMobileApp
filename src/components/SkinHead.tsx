// 头像：游戏内玩家的皮肤头部（Skia 最近邻采样，像素风不发糊）/ App 消息的字母默认头像。
//
// 为什么不用 RN 的 <Image>：Android 的 ImageView 只有双线性过滤，把 8×8 的头部放大到
// 32–48dp 会糊成一团。LittleSkin 网页上的头像清晰，是因为用了 nearest-neighbor。
// 这里用 Skia 的 ImageShader + FilterMode.Nearest 直接把皮肤对应区域采出来，边缘是硬的。
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { Canvas, ImageShader, Rect, Skia } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
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
  const uri = game ? av.uri : null;
  const [skin, setSkin] = useState<SkImage | null>(null);

  // Skia 的 useImage 对 file:// 不一定可靠：自己按 base64 读文件、解码成 SkImage
  useEffect(() => {
    setSkin(null);
    if (!uri) return;
    let alive = true;
    FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
      .then((b64) => {
        if (!alive) return;
        const data = Skia.Data.fromBase64(b64);
        const img = Skia.Image.MakeImageFromEncoded(data);
        if (!img) {
          invalidateAvatar(name);
          return;
        }
        setSkin(img);
      })
      .catch(() => {
        if (alive) invalidateAvatar(name);
      });
    return () => {
      alive = false;
    };
  }, [uri, name]);

  if (size <= 0) return null;

  const radius = Math.max(5, Math.round(size * 0.2));
  const crop = skin ? skinCrop(size, skin.width(), skin.height()) : null;
  const isServer = kind === 4;
  const isMusic = kind === 5;

  const face = isServer ? (
    <IconAvatar size={size} icon="server" tone="accent" />
  ) : isMusic ? (
    <IconAvatar size={size} icon="disc" tone="accent2" />
  ) : skin && crop ? (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: '#00000022',
        }}
      >
        <Canvas style={{ width: size, height: size }}>
          {/* 底层：头部正面，rect 把皮肤 (8,8) 对齐到画布左上角，最近邻放大 */}
          <Rect x={0} y={0} width={size} height={size}>
            <ImageShader
              image={skin}
              fit="fill"
              rect={{ x: crop.left, y: crop.top, width: crop.imageWidth, height: crop.imageHeight }}
              tx="clamp"
              ty="clamp"
              fm="nearest"
              mm="none"
            />
          </Rect>
          {/* 上层：帽子 / 发型，透明区域不影响底层 */}
          <Rect x={0} y={0} width={size} height={size}>
            <ImageShader
              image={skin}
              fit="fill"
              rect={{ x: crop.hatLeft, y: crop.top, width: crop.imageWidth, height: crop.imageHeight }}
              tx="clamp"
              ty="clamp"
              fm="nearest"
              mm="none"
            />
          </Rect>
        </Canvas>
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

function IconAvatar({
  size,
  icon,
  tone,
}: {
  size: number;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'accent' | 'accent2';
}) {
  const { colors } = useTheme();
  const bg = tone === 'accent' ? colors.accentSoft : colors.accent2Soft;
  const fg = tone === 'accent' ? colors.accent : colors.accent2;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(5, Math.round(size * 0.2)),
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={Math.round(size * 0.56)} color={fg} />
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
