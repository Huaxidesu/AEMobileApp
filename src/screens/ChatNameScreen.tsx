// 改聊天昵称。设置页和聊天页顶部都跳这里 —— 只有一处编辑逻辑。
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChat } from '../chat';
import { showToast } from '../toast';
import { themedStyles, useTheme, spacing, radius } from '../theme';

export default function ChatNameScreen({ navigation }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { name, setName } = useChat();
  const [v, setV] = useState(name);
  const ok = v.trim().length > 0;

  const save = () => {
    if (!ok) return;
    setName(v);
    showToast('昵称已保存', 'ok');
    navigation.goBack();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.l, paddingBottom: insets.bottom + spacing.xxl }}>
      <Text style={styles.label}>游戏里显示为</Text>
      <View style={[styles.preview, { backgroundColor: colors.surfaceAlt }]}>
        <Text style={[styles.previewTag, { color: colors.textDim }]}>[AEMobile]</Text>
        <Text style={[styles.previewName, { color: colors.accent }]}>[{v.trim() || '你的名字'}]</Text>
        <Text style={[styles.previewBody, { color: colors.text }]}> 消息内容</Text>
      </View>

      <Text style={[styles.label, { marginTop: spacing.l }]}>昵称</Text>
      <TextInput
        style={styles.input}
        value={v}
        onChangeText={setV}
        placeholder="例如：老王"
        placeholderTextColor={colors.textFaint}
        maxLength={16}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <Text style={styles.hint}>
        1–16 个字。中括号会被自动去掉，避免伪装成别人的前缀；这个昵称不绑定游戏账号，只用来区分是谁在说话。
      </Text>

      <Pressable style={[styles.btn, !ok && { opacity: 0.4 }]} onPress={save} disabled={!ok}>
        <Text style={styles.btnText}>保存</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = themedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  label: { color: colors.textDim, fontSize: 11, fontWeight: '700', marginBottom: spacing.s, letterSpacing: 0.4 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radius.m,
  },
  previewTag: { fontSize: 13 },
  previewName: { fontSize: 13, fontWeight: '700' },
  previewBody: { fontSize: 13 },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
  },
  hint: { color: colors.textFaint, fontSize: 11, lineHeight: 17, marginTop: spacing.s },
  btn: {
    marginTop: spacing.xl,
    paddingVertical: 13,
    borderRadius: radius.m,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  btnText: { color: colors.bg, fontSize: 14, fontWeight: '700' },
}));
