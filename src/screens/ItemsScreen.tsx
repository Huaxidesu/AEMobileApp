// 物品终端：搜索 + 过滤 + 排序 + 网格浏览
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useConfig } from '../config';
import { ItemStackResp, openStream, formatItemCount, parseFrame, itemKey } from '../api';
import type { Stream } from '../net/conn';
import { ItemAccumulator, frameError } from '../frames';
import { resolveItem, ResolvedItem } from '../db';
import { formatAgo, readCache, scopeKey, writeCache } from '../cache';
import { colors, spacing, radius } from '../theme';
import { Chip, EmptyState, StatusDot, CenterLoading, ItemIcon } from '../components';

type SortKey = 'count' | 'name' | 'mod';
const SORT_LABELS: Record<SortKey, string> = { count: '数量', name: '名称', mod: '模组' };

interface Row extends ResolvedItem {
  count: number;
  craftable: boolean;
  key: string;
}

export default function ItemsScreen({ navigation }: any) {
  const db = useSQLiteContext();
  const { config } = useConfig();
  // 状态栏是透明的（内容画在它下面），顶部要自己让出高度
  const insets = useSafeAreaInsets();
  const [raw, setRaw] = useState<ItemStackResp[]>([]);
  const [connected, setConnected] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [keyword, setKeyword] = useState('');
  /** 防抖后的关键词：直接拿显示名过滤（物品/流体/源质都能搜到，不查库） */
  const [kwApplied, setKwApplied] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 当前列表来自缓存的写入时间；联网收到新帧后清空 */
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const esRef = useRef<Stream | null>(null);
  const lastAt = useRef(0);
  const lastKey = useRef('');
  /** 已经收到过实时帧：迟到的缓存读取不能覆盖它 */
  const liveRef = useRef(false);

  // 物品列表是最大的一份服务端数据（几千条），按「主网 + 过滤条件」分别落盘
  const cacheKey = `items:${scopeKey(config)}:${showAll ? 'all' : 'craftable'}`;

  // 先读缓存：冷启动/离线时立刻有内容，联网后由 SSE 覆盖
  useEffect(() => {
    let alive = true;
    liveRef.current = false;
    setCachedAt(null);
    setRaw([]);
    setLoading(true);
    readCache<ItemStackResp[]>(cacheKey).then((hit) => {
      if (!alive || !hit || liveRef.current) return;
      setRaw(hit.data);
      setCachedAt(hit.at);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [cacheKey]);

  const connKey = String(showAll);
  const accRef = useRef(new ItemAccumulator());
  const connKeyRef = useRef('');

  const connect = useCallback(() => {
    esRef.current?.close();
    if (!config.mainnet) return;
    setError(null);
    setLoading(true);
    // 过滤条件变了就是另一份数据，增量和旧 sid 都不能沿用
    if (connKeyRef.current !== connKey) {
      accRef.current.reset();
      connKeyRef.current = connKey;
    }
    const { dimid, x, y, z } = config.mainnet;
    const es: Stream = openStream(config, 'items', {
      x, y, z, dimid,
      craftableOnly: !showAll,
      // 断线重连带上次的 sid：服务端能接着发增量，省掉一次全量
      sid: accRef.current.sid || undefined,
    });
    esRef.current = es;
    es.addEventListener('message', (ev: any) => {
      const frame = parseFrame(ev.data);
      if (!frame) {
        setError('数据解析失败');
        return;
      }
      const err = frameError(frame);
      if (err) {
        setError(err);
        es.close();
        setConnected(false);
        setLoading(false);
        return;
      }
      const kind = accRef.current.apply(frame);
      if (kind === 'heartbeat') {
        setConnected(true);
        return;
      }
      const list = accRef.current.list();
      liveRef.current = true;
      setRaw(list);
      setCachedAt(null);
      lastAt.current = Date.now();
      setConnected(true);
      setLoading(false);
      // 帧间隔 600s，限 10s 一次写盘足以覆盖刷新按钮连点的情况
      writeCache(cacheKey, list, 10000);
    });
    // 断线重连由 net/conn.ts 统一处理：重连成功后会自动续订，这里的监听器不用重建
    es.addEventListener('error', (ev: any) => {
      setConnected(false);
      setLoading(false);
      setError(ev?.xhrStatus === 401 ? '密码错误或已失效，请到设置里重新粘贴' : '无法连接服务器');
    });
  }, [config, showAll, cacheKey, connKey]);

  // 只在页面可见时保持连接：SSE 每 600s 推一帧（首帧全量、之后增量），切走就断
  // 4 分钟内切回来且参数没变就不重连，直接用内存里的那份
  useFocusEffect(
    useCallback(() => {
      if (Date.now() - lastAt.current > 240000 || lastKey.current !== connKey) {
        lastKey.current = connKey;
        connect();
      }
      return () => {
        esRef.current?.close();
        esRef.current = null;
      };
    }, [connect, connKey]),
  );

  // 搜索防抖
  useEffect(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) {
      setKwApplied('');
      return;
    }
    const t = setTimeout(() => setKwApplied(kw), 200);
    return () => clearTimeout(t);
  }, [keyword]);

  const rows: Row[] = useMemo(() => {
    let list = raw.map((r) => {
      const resolved = resolveItem(db, { name: r.item_name, meta: r.meta, nbt: r.nbt });
      // key 必须带上 nbt：流体滴共用 ae2fc:fluid_drop:0，不带 nbt 的话 771 条流体全是重复 key，
      // FlatList 会把它们当成同一项（只渲染一条，甚至全部丢掉）
      return { ...resolved, count: r.count, craftable: r.craftable, key: itemKey(r.item_name, r.meta, r.nbt) };
    });
    // 按「显示名」过滤：物品用库里的 dname，流体/源质用解析出来的中文名，所以三类都能搜到
    if (kwApplied) {
      list = list.filter(
        (r) => (r.dname ?? '').toLowerCase().includes(kwApplied) || r.name.toLowerCase().includes(kwApplied),
      );
    }
    const dir = sortAsc ? 1 : -1;
    list.sort((a, b) => {
      let r = 0;
      if (sortKey === 'count') r = a.count - b.count;
      else if (sortKey === 'mod') r = (a.name.split(':')[0] ?? '').localeCompare(b.name.split(':')[0] ?? '');
      else r = (a.dname ?? a.name).localeCompare(b.dname ?? b.name, 'zh');
      return r * dir;
    });
    return list;
  }, [raw, kwApplied, sortKey, sortAsc]);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => (
      <TouchableOpacity
        style={tileStyles.tile}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('ItemDetail', { item })}
      >
        <ItemIcon uri={item.icon} size={40} fluid={item.isFluid} fluidColor={item.fluidColor} tint={item.aspectTint} />
        <View style={{ position: 'absolute', right: 6, bottom: 6 }}>
          <Text style={tileStyles.count}>{formatItemCount(item.count)}</Text>
        </View>
        {item.craftable ? (
          <View style={{ position: 'absolute', right: 4, top: 4 }}>
            <Ionicons name="hammer" size={11} color={colors.accent} />
          </View>
        ) : null}
      </TouchableOpacity>
    ),
    [],
  );

  const numColumns = 4;

  return (
    <View style={styles.screen}>
      {/* 顶部栏 */}
      <View style={[styles.header, { paddingTop: spacing.l + insets.top }]}>
        <View>
          <Text style={styles.title}>物品终端</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <StatusDot ok={connected} />
            <Text style={styles.subtitle}>
              {connected
                ? `${config.ip}:${config.port}`
                : cachedAt
                ? `离线缓存 · ${formatAgo(cachedAt)}`
                : error ?? '连接中…'}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={connect} style={styles.iconBtn}>
          <Ionicons name="refresh" size={20} color={connected ? colors.textDim : colors.accent} />
        </TouchableOpacity>
      </View>

      {/* 搜索栏 */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={17} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索物品名称…"
          placeholderTextColor={colors.textFaint}
          value={keyword}
          onChangeText={setKeyword}
          autoCorrect={false}
        />
        {keyword ? (
          <TouchableOpacity onPress={() => setKeyword('')}>
            <Ionicons name="close-circle" size={17} color={colors.textFaint} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* 过滤行 */}
      <View style={styles.filterRow}>
        <TouchableOpacity style={[styles.segBtn, !showAll && styles.segBtnActive]} onPress={() => setShowAll(false)}>
          <Ionicons name="hammer" size={13} color={!showAll ? colors.accent : colors.textDim} />
          <Text style={[styles.segText, !showAll && { color: colors.accent }]}>可合成</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segBtn, showAll && styles.segBtnActive]} onPress={() => setShowAll(true)}>
          <Ionicons name="layers" size={13} color={showAll ? colors.accent : colors.textDim} />
          <Text style={[styles.segText, showAll && { color: colors.accent }]}>全部</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={[styles.segBtn, styles.segBtnActive]}
          onPress={() => {
            const order: SortKey[] = ['count', 'name', 'mod'];
            setSortKey(order[(order.indexOf(sortKey) + 1) % 3]);
          }}
        >
          <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={13} color={colors.accent} />
          <Text style={[styles.segText, { color: colors.accent }]}>{SORT_LABELS[sortKey]}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.segBtn} onPress={() => setSortAsc(!sortAsc)}>
          <Ionicons name="swap-vertical" size={13} color={colors.textDim} />
        </TouchableOpacity>
      </View>

      {/* 离线提示：有缓存时不遮挡内容，只在顶部说明数据时间 */}
      {!connected && cachedAt ? (
        <View style={styles.offlineBar}>
          <Ionicons name="cloud-offline-outline" size={13} color={colors.warn} />
          <Text style={styles.offlineText} numberOfLines={1}>
            显示 {formatAgo(cachedAt)} 的缓存，正在重连服务器…
          </Text>
        </View>
      ) : null}

      {/* 列表 */}
      {loading && rows.length === 0 ? (
        <CenterLoading text="正在拉取网络物品…" />
      ) : error && !connected && rows.length === 0 ? (
        <EmptyState icon="cloud-offline" title="连接失败" subtitle={error ?? undefined} />
      ) : rows.length === 0 ? (
        <EmptyState icon="cube-outline" title="没有匹配的物品" subtitle={keyword ? '换个关键词试试' : 'ME 网络里没有存储物品'} />
      ) : (
        <FlatList
          key={`grid-${numColumns}`}
          data={rows}
          numColumns={numColumns}
          keyExtractor={(r) => r.key}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.m, gap: spacing.s }}
          columnWrapperStyle={{ gap: spacing.s }}
          initialNumToRender={40}
          maxToRenderPerBatch={40}
          windowSize={7}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.l,
    paddingTop: spacing.l,
    paddingBottom: spacing.s,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.textFaint, fontSize: 11 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.m,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    marginHorizontal: spacing.l,
    marginVertical: spacing.s,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 10 },
  offlineBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: spacing.l,
    marginBottom: spacing.s,
    paddingHorizontal: spacing.m,
    paddingVertical: 7,
    borderRadius: radius.s,
    backgroundColor: colors.warnSoft,
  },
  offlineText: { color: colors.warn, fontSize: 11, flex: 1 },
  filterRow: { flexDirection: 'row', gap: spacing.s, paddingHorizontal: spacing.l, paddingBottom: spacing.s },
  segBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segBtnActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  segText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
});

const tileStyles = StyleSheet.create({
  tile: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    color: colors.text,
    fontSize: 9,
    fontWeight: '700',
    backgroundColor: 'rgba(11,14,20,0.85)',
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
