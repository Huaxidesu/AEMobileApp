// 音乐：AllMusic 点歌 / 搜歌 / 队列 / 投票。
//
// 命令不直接在这里拼成公屏聊天：走 api.sendMusic → 后端 mod → 代理上的 AEMobileBridge，
// 由桥接插件以“这个 App 绑定码对应的玩家”身份执行 /music，结果只回这台手机。
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useConfig } from '../config';
import { useChat } from '../chat';
import { sendMusic } from '../api';
import { friendly, parseEntries } from '../musicout';
import type { MusicEntry } from '../musicout';
import type { ServerConfig } from '../api';
import { showToast } from '../toast';
import { themedStyles, useTheme, spacing, radius } from '../theme';

export default function MusicScreen() {
  const { colors } = useTheme();
  const { config, complete } = useConfig();
  const { msgs } = useChat();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MusicEntry[]>([]);
  const [queue, setQueue] = useState<MusicEntry[]>([]);
  const [raw, setRaw] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState<boolean | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [advanced, setAdvanced] = useState('');

  const nowPlaying = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].kind === 5) return msgs[i].text;
    }
    return '';
  }, [msgs]);

  const run = useCallback(
    async (cmd: string, args: string[] = [], opts?: { silent?: boolean }) => {
      if (!complete) {
        setError('先在设置里配置服务器和绑定码');
        return null;
      }
      if (!opts?.silent) setBusy(true);
      try {
        const r = await sendMusic(config as ServerConfig, cmd, args);
        setOnline(r.online);
        if (!opts?.silent) {
          setRaw(r.lines);
          if (!r.ok) {
            const msg = friendly(r.message, r.lines);
            setError(msg);
            showToast(msg, 'bad');
          } else {
            setError('');
          }
        }
        return r;
      } catch (e: any) {
        if (!opts?.silent) {
          const msg = String(e?.message ?? '音乐请求失败');
          setError(msg);
          showToast(msg, 'bad');
        }
        return null;
      } finally {
        if (!opts?.silent) setBusy(false);
      }
    },
    [config, complete],
  );

  const refreshQueue = useCallback(async () => {
    const r = await run('list', [], { silent: true });
    if (!r) return;
    const entries = parseEntries(r.lines);
    setQueue(r.ok || entries.length > 0 ? entries : []);
  }, [run]);

  useEffect(() => {
    if (complete) refreshQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

  const onSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || busy) return;
    Keyboard.dismiss();
    const r = await run('search', [q]);
    if (!r) return;
    setResults(parseEntries(r.lines));
    setHasNext(r.lines.some((l) => l.includes('nextpage')));
    if (r.lines.length === 0 && r.ok) showToast('没有搜到结果', 'bad');
  }, [query, busy, run]);

  const onSelect = useCallback(
    async (index: number) => {
      const r = await run('select', [String(index)]);
      if (r) {
        setShowRaw(true);
        setTimeout(() => refreshQueue(), 1500);
      }
    },
    [run, refreshQueue],
  );

  const onPage = useCallback(
    async (dir: 'nextpage' | 'lastpage') => {
      const r = await run(dir);
      if (!r) return;
      const entries = parseEntries(r.lines);
      if (entries.length > 0) setResults(entries);
      setHasNext(r.lines.some((l) => l.includes('nextpage')));
    },
    [run],
  );

  const onAction = useCallback(
    async (cmd: string, args: string[] = []) => {
      const r = await run(cmd, args);
      if (r) {
        setShowRaw(true);
        if (cmd === 'stop' || cmd === 'next' || cmd === 'vote' || cmd === 'push' || cmd === 'cancel') {
          setTimeout(() => refreshQueue(), 1500);
        }
      }
    },
    [run, refreshQueue],
  );

  const onAdvanced = useCallback(async () => {
    const v = advanced.trim();
    if (!v || busy) return;
    const parts = v.split(/\s+/);
    const cmd = parts.shift() || '';
    if (!cmd) return;
    Keyboard.dismiss();
    await onAction(cmd, parts);
    setAdvanced('');
  }, [advanced, busy, onAction]);

  const action = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, tone?: 'bad') => (
    <Pressable
      style={[styles.actionBtn, tone === 'bad' && { borderColor: colors.bad }]}
      onPress={onPress}
      disabled={busy}
    >
      <Ionicons name={icon} size={15} color={tone === 'bad' ? colors.bad : colors.accent} />
      <Text style={[styles.actionText, tone === 'bad' && { color: colors.bad }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xxl, gap: spacing.l }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 正在播放 */}
        <View style={styles.nowCard}>
          <View style={styles.nowIcon}>
            <Ionicons name="disc" size={26} color={colors.accent2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.groupTitle}>正在播放</Text>
            <Text style={styles.nowText} numberOfLines={3}>
              {nowPlaying || '暂无播放信息'}
            </Text>
            <Text style={styles.nowHint}>
              {online === false
                ? '你当前不在游戏内：搜歌/队列可用，点歌需要服务器有音乐会话'
                : online === true
                  ? '你当前在游戏内'
                  : ' '}
            </Text>
          </View>
          <Pressable style={styles.iconBtn} onPress={refreshQueue} disabled={busy} hitSlop={8}>
            <Ionicons name="refresh" size={18} color={colors.textDim} />
          </Pressable>
        </View>

        {error ? (
          <View style={[styles.errorCard, { borderColor: colors.bad }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.bad} />
            <Text style={{ color: colors.bad, fontSize: 12, flex: 1, lineHeight: 18 }}>{error}</Text>
          </View>
        ) : null}

        {/* 搜歌 */}
        <View>
          <Text style={styles.sectionTitle}>搜歌 / 点歌</Text>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={colors.textFaint} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="歌名或歌手，例如：晴天"
              placeholderTextColor={colors.textFaint}
              returnKeyType="search"
              onSubmitEditing={onSearch}
            />
            <Pressable style={[styles.searchBtn, (!query.trim() || busy) && { opacity: 0.4 }]} onPress={onSearch} disabled={!query.trim() || busy}>
              <Text style={styles.searchBtnText}>搜索</Text>
            </Pressable>
          </View>

          {results.length === 0 ? (
            <Text style={styles.hint}>
              搜索结果会只回给你，不会发到公屏。点结果右侧的「点歌」即可加入队列。
            </Text>
          ) : (
            <View style={styles.listCard}>
              {results.map((e, i) => (
                <View key={`${e.index}-${e.title}-${i}`} style={[styles.entry, i < results.length - 1 && styles.divider]}>
                  <Text style={styles.index}>{e.index}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.entryTitle} numberOfLines={1}>
                      {e.title}
                    </Text>
                    <Text style={styles.entrySub} numberOfLines={1}>
                      {e.artist}
                      {e.album ? ` · ${e.album}` : ''}
                    </Text>
                  </View>
                  <Pressable style={styles.playBtn} onPress={() => onSelect(e.index)} disabled={busy}>
                    <Ionicons name="play" size={13} color={colors.bg} />
                    <Text style={styles.playText}>点歌</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {results.length > 0 ? (
            <View style={styles.pageRow}>
              <Pressable style={styles.pageBtn} onPress={() => onPage('lastpage')} disabled={busy}>
                <Ionicons name="chevron-back" size={14} color={colors.textDim} />
                <Text style={styles.pageText}>上一页</Text>
              </Pressable>
              <Pressable style={[styles.pageBtn, !hasNext && { opacity: 0.4 }]} onPress={() => onPage('nextpage')} disabled={busy || !hasNext}>
                <Text style={styles.pageText}>下一页</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textDim} />
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* 队列 */}
        <View>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>队列</Text>
            <Pressable onPress={refreshQueue} disabled={busy} hitSlop={8}>
              <Text style={styles.link}>刷新</Text>
            </Pressable>
          </View>
          {queue.length === 0 ? (
            <Text style={styles.hint}>队列是空的，或者当前没有正在播放的歌曲。</Text>
          ) : (
            <View style={styles.listCard}>
              {queue.map((e, i) => (
                <View key={`q-${e.index}-${i}`} style={[styles.entry, i < queue.length - 1 && styles.divider]}>
                  <Text style={styles.index}>{e.index}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.entryTitle} numberOfLines={1}>
                      {e.title}
                    </Text>
                    <Text style={styles.entrySub} numberOfLines={1}>
                      {e.artist}
                      {e.album ? ` · ${e.album}` : ''}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable style={styles.miniBtn} onPress={() => onAction('push', [String(e.index)])} disabled={busy}>
                      <Text style={styles.miniText}>插队</Text>
                    </Pressable>
                    <Pressable style={styles.miniBtn} onPress={() => onAction('cancel', [String(e.index)])} disabled={busy}>
                      <Text style={styles.miniText}>取消</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* 操作 */}
        <View>
          <Text style={styles.sectionTitle}>操作</Text>
          <View style={styles.actions}>
            {action('thumbs-up-outline', '投票切歌', () => onAction('vote'))}
            {action('close-circle-outline', '取消投票', () => onAction('vote', ['cancel']))}
            {action('remove-circle-outline', '取消插队', () => onAction('push', ['cancel']))}
            {action('stop-circle-outline', '停止播放', () => onAction('stop'))}
            {action('volume-mute-outline', '不再点歌', () => onAction('mute'))}
            {action('list-outline', '静音列表', () => onAction('mute', ['list']))}
          </View>
        </View>

        {/* 高级 */}
        <View>
          <Text style={styles.sectionTitle}>高级 / 帮助</Text>
          <View style={styles.actions}>
            {action('help-circle-outline', 'music help', () => onAction('help'))}
            {action('play-forward-outline', '强制切歌', () => onAction('next'))}
          </View>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              value={advanced}
              onChangeText={setAdvanced}
              placeholder="原生 /music 子命令，如 nextpage、delete 1"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              returnKeyType="send"
              onSubmitEditing={onAdvanced}
            />
            <Pressable style={[styles.searchBtn, (!advanced.trim() || busy) && { opacity: 0.4 }]} onPress={onAdvanced} disabled={!advanced.trim() || busy}>
              <Text style={styles.searchBtnText}>发送</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>管理命令（next / delete / ban / addlist / hud）需要游戏内对应权限；没有权限时会把 AllMusic 的报错原样显示。</Text>
        </View>

        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.hint}>正在请求 AllMusic…</Text>
          </View>
        ) : null}

        {raw.length > 0 ? (
          <View>
            <Pressable style={styles.sectionHead} onPress={() => setShowRaw((v) => !v)}>
              <Text style={styles.sectionTitle}>服务器返回</Text>
              <Ionicons name={showRaw ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textFaint} />
            </Pressable>
            {showRaw ? (
              <View style={styles.rawCard}>
                {raw.map((line, i) => (
                  <Text key={i} style={styles.rawText} selectable>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  groupTitle: { color: colors.textFaint, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  sectionTitle: { color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.s },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  nowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    padding: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nowIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accent2Soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nowText: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 2, lineHeight: 20 },
  nowHint: { color: colors.textFaint, fontSize: 10, marginTop: 3, lineHeight: 14 },
  iconBtn: { padding: 6 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.s,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 10 },
  searchBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.s,
    backgroundColor: colors.accent,
  },
  searchBtnText: { color: colors.bg, fontSize: 12, fontWeight: '700' },
  hint: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 4 },
  listCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, paddingHorizontal: spacing.m, paddingVertical: 10 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  index: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    minWidth: 22,
    textAlign: 'center',
  },
  entryTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  entrySub: { color: colors.textFaint, fontSize: 10, marginTop: 2 },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accent,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.full,
  },
  playText: { color: colors.bg, fontSize: 11, fontWeight: '700' },
  miniBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.s,
    backgroundColor: colors.surfaceAlt,
  },
  miniText: { color: colors.textDim, fontSize: 10, fontWeight: '600' },
  pageRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.s },
  pageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.s,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pageText: { color: colors.textDim, fontSize: 11 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, marginBottom: spacing.s },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.s,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: spacing.m,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
  },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rawCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.m,
    gap: 2,
  },
  rawText: { color: colors.textDim, fontSize: 11, lineHeight: 16, fontFamily: 'monospace' },
}));
