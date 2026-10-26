// 物品终端：搜索 + 过滤 + 排序 + 网格浏览
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import EventSource from 'react-native-sse';
import { Ionicons } from '@expo/vector-icons';
import { useConfig } from '../config';
import { ApiResponse, ItemStackResp, openSSE, formatItemCount } from '../api';
import { resolveItem, searchItemKeys, ResolvedItem } from '../db';
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
  const [raw, setRaw] = useState<ItemStackResp[]>([]);
  const [connected, setConnected] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [keyword, setKeyword] = useState('');
  const [filterKeys, setFilterKeys] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const lastAt = useRef(0);
  const lastKey = useRef('');

  const connect = useCallback(() => {
    esRef.current?.close();
    if (!config.mainnet) return;
    setError(null);
    setLoading(true);
    const { dimid, x, y, z } = config.mainnet;
    const es: EventSource = openSSE(config, '/AE2/getItems', {
      ownerUUID: config.uuid,
      x, y, z, dimid,
      craftableOnly: !showAll,
    });
    esRef.current = es;
    es.addEventListener('message', (ev: any) => {
      try {
        const resp: ApiResponse<ItemStackResp[]> = JSON.parse(ev.data);
        if (!resp.succeed) {
          setError(resp.message ?? '服务器拒绝请求');
          es.close();
          setConnected(false);
          return;
        }
        setRaw(resp.body ?? []);
        lastAt.current = Date.now();
        setConnected(true);
        setLoading(false);
      } catch (e) {
        setError('数据解析失败');
      }
    });
    es.addEventListener('error', () => {
      setConnected(false);
      setLoading(false);
      setError('无法连接服务器');
    });
  }, [config, showAll]);

  // 只在页面可见时保持连接：SSE 每 300s 推一帧全量物品列表（越大越贵），切走就断
  // 4 分钟内切回来且参数没变就不重连，直接用内存里的那份
  const connKey = String(showAll);
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
    const kw = keyword.trim();
    if (!kw) {
      setFilterKeys(null);
      return;
    }
    const t = setTimeout(() => {
      searchItemKeys(db, kw).then(setFilterKeys).catch(() => setFilterKeys(null));
    }, 250);
    return () => clearTimeout(t);
  }, [keyword]);

  const rows: Row[] = useMemo(() => {
    let list = raw.map((r) => {
      const resolved = resolveItem(db, { name: r.item_name, meta: r.meta, nbt: r.nbt });
      return { ...resolved, count: r.count, craftable: r.craftable, key: `${r.item_name}:${r.meta}` };
    });
    if (filterKeys) list = list.filter((r) => filterKeys.has(`${r.original_name ?? r.name}:${r.original_meta ?? r.meta}`));
    const dir = sortAsc ? 1 : -1;
    list.sort((a, b) => {
      let r = 0;
      if (sortKey === 'count') r = a.count - b.count;
      else if (sortKey === 'mod') r = (a.name.split(':')[0] ?? '').localeCompare(b.name.split(':')[0] ?? '');
      else r = (a.dname ?? a.name).localeCompare(b.dname ?? b.name, 'zh');
      return r * dir;
    });
    return list;
  }, [raw, filterKeys, sortKey, sortAsc]);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => (
      <TouchableOpacity
        style={tileStyles.tile}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('ItemDetail', { item })}
      >
        <ItemIcon uri={item.icon} size={40} />
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
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>物品终端</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <StatusDot ok={connected} />
            <Text style={styles.subtitle}>
              {connected ? `${config.scheme}://${config.ip}` : error ?? '连接中…'}
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

      {/* 列表 */}
      {loading && rows.length === 0 ? (
        <CenterLoading text="正在拉取网络物品…" />
      ) : error && !connected ? (
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
