// 轻量 Toast：模块级 showToast + 挂载在根部的宿主组件
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { themedStyles, useTheme, Palette, radius, spacing } from './theme';

type ToastKind = 'ok' | 'bad' | 'info';
interface ToastData {
  msg: string;
  kind: ToastKind;
  key: number;
}

let listener: ((t: ToastData) => void) | null = null;
let seq = 0;

export function showToast(msg: string, kind: ToastKind = 'info') {
  listener?.({ msg, kind, key: ++seq });
}

const kindColor = (kind: ToastKind, colors: Palette): string =>
  kind === 'ok' ? colors.ok : kind === 'bad' ? colors.bad : colors.accent;

export function ToastHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<ToastData | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listener = (t) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setData(t);
      Animated.timing(anim, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setData(null));
      }, 2400);
    };
    return () => {
      listener = null;
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!data) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        { top: insets.top + spacing.m },
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }),
            },
          ],
        },
      ]}
    >
      <View style={[styles.card, { borderLeftColor: kindColor(data.kind, colors) }]}>
        <Text style={styles.text} numberOfLines={3}>
          {data.msg}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = themedStyles((colors) => ({
  wrap: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    maxWidth: '86%',
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.m,
    borderLeftWidth: 3,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  text: { color: colors.text, fontSize: 14 },
}));
