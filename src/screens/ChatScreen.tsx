// 聊天页：游戏内公屏 ↔ 手机双向，Telegram 式气泡。
//
// 消息状态全在 ChatProvider（常驻订阅 + 7 天本地缓存），这里只负责渲染和发送。
// 分组/日期/系统行由 chatgroup.ts（纯函数，有单测）算好，展示交给 chatview.tsx，
// 这样「聊天外观」设置里的预览和真实页面用的是同一套组件。
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useChat } from '../chat';
import { useChatPrefs } from '../chatprefs';
import { buildRows } from '../chatgroup';
import type { ChatRow } from '../chatgroup';
import { DayDivider, MessageGroup, SystemLine } from '../chatview';
import { SkinHead } from '../components/SkinHead';
import { showToast } from '../toast';
import { themedStyles, useTheme, spacing, radius } from '../theme';

const MAX_TEXT = 200;

export default function ChatScreen({ navigation }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const { prefs } = useChatPrefs();
  const { msgs, status, error, gap, name, send, setActive, clear } = useChat();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<ChatRow>>(null);
  /** 用户是否贴着底部：贴底时来新消息才自动跟随，往上翻历史时不打扰 */
  const atBottom = useRef(true);

  useFocusEffect(
    useCallback(() => {
      setActive(true);
      // 进页面直接看最新一条（历史是异步载入的，onContentSizeChange 会再兜一次）
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
      return () => setActive(false);
    }, [setActive]),
  );

  const rows = useMemo<ChatRow[]>(() => {
    return buildRows(msgs, { mine: name, showJoinLeave: prefs.showJoinLeave });
  }, [msgs, name, prefs.showJoinLeave]);

  const maxBubbleWidth = Math.round((win.width * prefs.bubbleMaxWidth) / 100);

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await send(text);
      setDraft('');
      atBottom.current = true;
    } catch (e: any) {
      showToast(String(e?.message ?? '发送失败'), 'bad');
    } finally {
      setBusy(false);
    }
  }, [draft, busy, send]);

  const onClear = useCallback(() => {
    Alert.alert('清空聊天记录', '只清这台手机上的本地记录，游戏里和其他设备不受影响。', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: clear },
    ]);
  }, [clear]);

  if (!name) return <NameGate />;

  const online = status === 'online';
  const statusText = online ? '已连接' : status === 'connecting' ? '连接中' : status === 'error' ? error || '未连接' : '未连接';

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: spacing.l + insets.top }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>聊天</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <View style={[styles.dot, { backgroundColor: online ? colors.ok : status === 'error' ? colors.bad : colors.warn }]} />
            <Text style={styles.subtitle} numberOfLines={1}>
              {statusText}
            </Text>
          </View>
        </View>
        <Pressable style={styles.nameChip} onPress={() => navigation.navigate('ChatName')}>
          <SkinHead name={name} size={18} kind={1} />
          <Text style={styles.nameText} numberOfLines={1}>
            {name}
          </Text>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => navigation.navigate('Music')} hitSlop={8}>
          <Ionicons name="musical-notes-outline" size={18} color={colors.accent} />
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={onClear} hitSlop={8}>
          <Ionicons name="trash-outline" size={17} color={colors.textDim} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingTop: spacing.s, paddingBottom: spacing.m, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          atBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 48;
        }}
        scrollEventThrottle={64}
        onContentSizeChange={() => {
          if (atBottom.current) listRef.current?.scrollToEnd({ animated: false });
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={34} color={colors.textFaint} />
            <Text style={styles.emptyText}>还没有消息</Text>
            <Text style={styles.emptyHint}>游戏里的公屏会实时出现在这里</Text>
          </View>
        }
        renderItem={({ item }) => {
          if (item.type === 'day') return <DayDivider label={item.label} />;
          if (item.type === 'system') return <SystemLine msg={item.msg} join={item.join} />;
          return <MessageGroup row={item} prefs={prefs} maxBubbleWidth={maxBubbleWidth} />;
        }}
      />

      {gap ? (
        <Text style={styles.gap}>中间有消息已过期（服务端只保留最近 30 秒，且不存储历史）</Text>
      ) : null}

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={online ? '说点什么…' : '连接断开，恢复后可发送'}
          placeholderTextColor={colors.textFaint}
          maxLength={MAX_TEXT}
          multiline
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={onSend}
        />
        <Pressable
          style={[styles.sendBtn, (!draft.trim() || busy) && { opacity: 0.4 }]}
          onPress={onSend}
          disabled={!draft.trim() || busy}
        >
          <Ionicons name="send" size={16} color={colors.bg} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** 首次进入的昵称门槛：不填就发不出消息，填完立刻能聊 */
function NameGate() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { setName } = useChat();
  const [v, setV] = useState('');
  const ok = v.trim().length > 0;
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.gate}>
        <View style={[styles.gateIcon, { backgroundColor: colors.accentSoft }]}>
          <Ionicons name="chatbubbles" size={26} color={colors.accent} />
        </View>
        <Text style={styles.gateTitle}>给聊天起个名字</Text>
        <Text style={styles.gateBody}>
          游戏里会显示成 <Text style={{ color: colors.accent }}>[AEMobile][{v.trim() || '你的名字'}]</Text>。
          这不是游戏账号，只是给自己看的标签，随时能改。
        </Text>
        <TextInput
          style={styles.gateInput}
          value={v}
          onChangeText={setV}
          placeholder="例如：老王"
          placeholderTextColor={colors.textFaint}
          maxLength={16}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => ok && setName(v)}
        />
        <Pressable
          style={[styles.gateBtn, !ok && { opacity: 0.4 }]}
          onPress={() => setName(v)}
          disabled={!ok}
        >
          <Text style={styles.gateBtnText}>开始聊天</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
    gap: spacing.s,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.textFaint, fontSize: 11, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  nameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: 140,
  },
  nameText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  iconBtn: { padding: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60, gap: 6 },
  emptyText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  emptyHint: { color: colors.textFaint, fontSize: 11 },
  gap: { color: colors.warn, fontSize: 11, textAlign: 'center', paddingBottom: 6 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 96,
    minHeight: 38,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 9,
    borderRadius: radius.m,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    fontSize: 14,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.m },
  gateIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  gateTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  gateBody: { color: colors.textDim, fontSize: 12, lineHeight: 19, textAlign: 'center' },
  gateInput: {
    alignSelf: 'stretch',
    marginTop: spacing.s,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    textAlign: 'center',
  },
  gateBtn: {
    alignSelf: 'stretch',
    paddingVertical: 13,
    borderRadius: radius.m,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  gateBtnText: { color: colors.bg, fontSize: 14, fontWeight: '700' },
}));
