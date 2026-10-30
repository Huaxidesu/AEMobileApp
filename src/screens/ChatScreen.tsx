// 聊天页：游戏内公屏 ↔ 手机双向，Telegram 式气泡。
//
// 消息状态全在 ChatProvider（常驻订阅 + 7 天本地缓存），这里只负责渲染和发送。
// 分组/日期/系统行由 chatgroup.ts（纯函数，有单测）算好，展示交给 chatview.tsx，
// 这样「聊天外观」设置里的预览和真实页面用的是同一套组件。
//
// 输入框是唯一入口：`/` 选模块、`@` 选人、`@allmusic` 打开命令面板。
// 发出去时由 commands.parseOutgoing 决定走聊天还是走音乐桥（命令不进公屏）。
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
import { useConfig } from '../config';
import { buildRows } from '../chatgroup';
import type { ChatRow } from '../chatgroup';
import { DayDivider, MessageGroup, SystemLine } from '../chatview';
import { SkinHead } from '../components/SkinHead';
import { CommandSheet, MentionSheet, ModuleSheet } from '../components/ChatSheets';
import { fetchPlayers, sendMusic } from '../api';
import type { ServerConfig } from '../api';
import {
  ALLMUSIC_NAME,
  CHAT_MODULES,
  canAskPlayers,
  commandArgs,
  commandText,
  mergeCandidates,
  parseOutgoing,
  trailingMention,
} from '../commands';
import type { ChatModule, MusicCmd } from '../commands';
import { plainMc } from '../mccolor';
import { showToast } from '../toast';
import { themedStyles, useTheme, spacing, radius } from '../theme';

const MAX_TEXT = 200;
/** 同一个 @ 候选列表 15 秒内不重复拉 */
const PLAYERS_TTL = 15000;

type SheetKind = 'module' | 'mention' | 'command' | null;

export default function ChatScreen({ navigation }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const { prefs } = useChatPrefs();
  const { config } = useConfig();
  const { msgs, status, error, gap, name, send, setActive, clear } = useChat();

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [cmdResult, setCmdResult] = useState<string[]>([]);
  const [cmdBusy, setCmdBusy] = useState(false);

  const listRef = useRef<FlatList<ChatRow>>(null);
  const inputRef = useRef<TextInput>(null);
  /** 用户是否贴着底部：贴底时来新消息才自动跟随，往上翻历史时不打扰 */
  const atBottom = useRef(true);
  /** 当前这个 `@` 在 draft 里的位置，选人时从这儿替换 */
  const mentionAt = useRef(-1);
  const playersAt = useRef(0);

  useFocusEffect(
    useCallback(() => {
      setActive(true);
      // 进页面直接看最新一条（历史是异步载入的，onContentSizeChange 会再兜一次）
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
      return () => setActive(false);
    }, [setActive]),
  );

  const rows = useMemo<ChatRow[]>(() => {
    return buildRows(msgs, {
      mine: name,
      showJoinLeave: prefs.showJoinLeave,
      showAchievements: prefs.showAchievements,
    });
  }, [msgs, name, prefs.showJoinLeave, prefs.showAchievements]);

  const maxBubbleWidth = Math.round((win.width * prefs.bubbleMaxWidth) / 100);

  // ---------------------------------------------------------------- 音乐桥

  const runMusic = useCallback(
    async (cmd: string, args: string[]) => {
      setCmdBusy(true);
      try {
        const r = await sendMusic(config as ServerConfig, cmd, args);
        setCmdResult(r.lines.slice(0, 6).map(plainMc));
        if (!r.ok) showToast(r.message || r.lines[0] || '执行失败', 'bad');
        return r;
      } catch (e: any) {
        showToast(String(e?.message ?? '音乐请求失败'), 'bad');
        return null;
      } finally {
        setCmdBusy(false);
      }
    },
    [config],
  );

  // ---------------------------------------------------------------- 面板

  const loadPlayers = useCallback(async () => {
    if (!canAskPlayers(config as ServerConfig)) return;
    if (Date.now() - playersAt.current < PLAYERS_TTL) return;
    playersAt.current = Date.now();
    setLoadingPlayers(true);
    const r = await fetchPlayers(config as ServerConfig);
    setCandidates(mergeCandidates(r.mc, r.app));
    setLoadingPlayers(false);
  }, [config]);

  /** 输入框内容变了就判断该弹哪个面板 */
  const onChangeText = useCallback(
    (v: string) => {
      setDraft(v);
      const t = v.trimStart();
      // 还在写模块名：`/`、`/music` 都算
      if (t.startsWith('/')) {
        setSheet('module');
        return;
      }
      // 已经选好 AllMusic：`@allmusic `、`@allmusic /music ` 都进命令面板
      if (/^@allmusic\s+(?:music\s+)?/i.test(t)) {
        setSheet('command');
        return;
      }
      const m = trailingMention(v);
      if (m) {
        mentionAt.current = m.start;
        setSheet('mention');
        loadPlayers();
        return;
      }
      setSheet((s) => (s ? null : s));
    },
    [loadPlayers],
  );

  const pickModule = useCallback((m: ChatModule) => {
    setDraft(m.prefix);
    setSheet('command');
    inputRef.current?.focus();
  }, []);

  const pickMention = useCallback(
    (who: string) => {
      if (who.toLowerCase() === ALLMUSIC_NAME) {
        setDraft('@allmusic ');
        setSheet('command');
        inputRef.current?.focus();
        return;
      }
      const at = mentionAt.current >= 0 ? mentionAt.current : draft.lastIndexOf('@');
      const next = (at >= 0 ? draft.slice(0, at) : draft) + `@${who} `;
      setDraft(next);
      setSheet(null);
      inputRef.current?.focus();
    },
    [draft],
  );

  const pickCommand = useCallback(
    async (c: MusicCmd) => {
      if (c.argHint) {
        // 要填参数的：把命令塞进输入框，光标停在末尾
        setDraft(commandText(c));
        setSheet(null);
        inputRef.current?.focus();
        return;
      }
      const { cmd, args } = commandArgs(c);
      setDraft('');
      await runMusic(cmd, args);
    },
    [runMusic],
  );

  // ---------------------------------------------------------------- 发送

  const onSend = useCallback(async () => {
    const out = parseOutgoing(draft);
    if (!out || busy || cmdBusy) return;
    if (out.kind === 'unknown') {
      showToast('App 发不了游戏命令，用 @allmusic 点歌', 'bad');
      return;
    }
    setBusy(true);
    try {
      if (out.kind === 'music') {
        const r = await runMusic(out.cmd, out.args);
        if (r) {
          setDraft('');
          setSheet(null);
        }
        return;
      }
      await send(out.text);
      setDraft('');
      setSheet(null);
      atBottom.current = true;
    } catch (e: any) {
      showToast(String(e?.message ?? '发送失败'), 'bad');
    } finally {
      setBusy(false);
    }
  }, [draft, busy, cmdBusy, send, runMusic]);

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
        onScrollBeginDrag={() => setSheet(null)}
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
          if (item.type === 'system') return <SystemLine msg={item.msg} variant={item.variant} />;
          return <MessageGroup row={item} prefs={prefs} maxBubbleWidth={maxBubbleWidth} me={name} />;
        }}
      />

      {sheet === 'module' ? (
        <ModuleSheet modules={CHAT_MODULES} onPick={pickModule} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'mention' ? (
        <MentionSheet
          players={candidates}
          allmusicLabel={ALLMUSIC_NAME}
          loading={loadingPlayers}
          onPick={pickMention}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'command' ? (
        <CommandSheet result={cmdResult} busy={cmdBusy} onPick={pickCommand} onClose={() => setSheet(null)} />
      ) : null}

      {gap ? (
        <Text style={styles.gap}>中间有消息已过期（服务端只保留最近 30 秒，且不存储历史）</Text>
      ) : null}

      <View style={styles.inputBar}>
        <Pressable
          style={styles.plusBtn}
          hitSlop={8}
          onPress={() => {
            // 面板开着的时候这个按钮是「关闭」，不能又弹回模块列表
            if (sheet) {
              setSheet(null);
              return;
            }
            setSheet('module');
            inputRef.current?.focus();
          }}
        >
          <Ionicons name={sheet ? 'close' : 'add'} size={19} color={colors.accent} />
        </Pressable>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={draft}
          onChangeText={onChangeText}
          placeholder={online ? '说点什么…（/ 模块，@ 提及）' : '连接断开，恢复后可发送'}
          placeholderTextColor={colors.textFaint}
          maxLength={MAX_TEXT}
          multiline
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={onSend}
        />
        <Pressable
          style={[styles.sendBtn, (!draft.trim() || busy || cmdBusy) && { opacity: 0.4 }]}
          onPress={onSend}
          disabled={!draft.trim() || busy || cmdBusy}
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
  plusBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    marginBottom: 2,
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
