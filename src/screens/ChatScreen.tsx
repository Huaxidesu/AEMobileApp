// 聊天页：游戏内公屏 ↔ 手机双向。
//
// 消息状态全在 ChatProvider（常驻订阅 + 7 天本地缓存），这里只负责渲染和发送。
// 首次进入必须先设昵称（游戏里显示成 [AEMobile][昵称]），之后可以在页头或设置里改。
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
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useChat } from '../chat';
import type { ChatMessage } from '../chat';
import { showToast } from '../toast';
import { themedStyles, useTheme, spacing, radius } from '../theme';

const MAX_TEXT = 200;

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export default function ChatScreen({ navigation }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { msgs, status, error, gap, name, send, setActive, clear } = useChat();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // 未读只在「没看这一页」时累加
  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, [setActive]),
  );

  /** inverted 列表要「新的在下面」，所以倒序喂进去 */
  const data = useMemo(() => msgs.slice().reverse(), [msgs]);

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await send(text);
      setDraft('');
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
          <Ionicons name="person-circle-outline" size={15} color={colors.accent} />
          <Text style={styles.nameText} numberOfLines={1}>
            {name}
          </Text>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={onClear} hitSlop={8}>
          <Ionicons name="trash-outline" size={17} color={colors.textDim} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={data}
        inverted
        keyExtractor={(m) => `${m.boot}:${m.seq}`}
        contentContainerStyle={{ paddingHorizontal: spacing.l, paddingVertical: spacing.m, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={34} color={colors.textFaint} />
            <Text style={styles.emptyText}>还没有消息</Text>
            <Text style={styles.emptyHint}>游戏里的公屏会实时出现在这里</Text>
          </View>
        }
        renderItem={({ item }) => <Bubble msg={item} mine={item.kind === 1 && item.name === name} />}
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

function Bubble({ msg, mine }: { msg: ChatMessage; mine: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
      <View style={{ maxWidth: '82%' }}>
        <Text style={[styles.meta, mine && { textAlign: 'right' }]}>
          {mine ? '我' : msg.name} · {timeLabel(msg.ts)}
        </Text>
        <View style={[styles.bubble, mine ? { backgroundColor: colors.accentSoft } : { backgroundColor: colors.surfaceAlt }]}>
          <Text style={[styles.bubbleText, mine && { color: colors.text }]}>{msg.text}</Text>
        </View>
      </View>
    </View>
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
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: 120,
  },
  nameText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  iconBtn: { padding: 6 },
  bubbleRow: { flexDirection: 'row', marginBottom: spacing.m },
  meta: { color: colors.textFaint, fontSize: 10, marginBottom: 3, marginHorizontal: 4 },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.m },
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 20 },
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
