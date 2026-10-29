// 物品终端：搜索 + 过滤 + 排序 + 网格浏览
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
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
import { themedStyles, useTheme, spacing, radius } from '../theme';
import { useGrid } from '../gridprefs';
import { Chip, EmptyState, StatusDot, CenterLoading, ItemIcon } from '../components';

type SortKey = 'count' | 'name' | 'mod';
const SORT_LABELS: Record<SortKey, string> = { count: '数量', name: '名称', mod: '模组' };

interface Row extends ResolvedItem {
  count: number;
  craftable: boolean;
  key: string;
}

export default function ItemsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { prefs, pageSize } = useGrid();
  const win = useWindowDimensions();
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
  /** 类型筛选：物品/流体/源质各自独立，可多选（默认全开） */
  const [kinds, setKinds] = useState({ item: true, fluid: true, essentia: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 当前页（0 起）；过滤/排序/每页容量一变就回到第一页 */
  const [page, setPage] = useState(0);
  /** 翻页模式下「点击页码跳转」的弹层 */
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpText, setJumpText] = useState('');
  /** 列表引用：翻页回顶、无限下滑的一键到顶/到底都靠它 */
  const listRef = useRef<FlatList<Row> | null>(null);
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
    // 类型筛选：三类互不影响，可以只留其中一两种
    if (!kinds.item || !kinds.fluid || !kinds.essentia) {
      list = list.filter((r) => (r.isFluid ? kinds.fluid : r.isEssentia ? kinds.essentia : kinds.item));
    }
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
  }, [raw, kwApplied, kinds, sortKey, sortAsc]);

  /** 网格宽度 → 单个格子宽度 → 图标尺寸（列数越多格子越小） */
  const tileW = Math.max(24, (win.width - spacing.m * 2 - spacing.s * (prefs.columns - 1)) / prefs.columns);
  /** 格子固定成正方形，最后一行不满时不会被 flex 拉宽（不自动缩放） */
  const tileSize = Math.floor(tileW);
  const iconSize = Math.round(Math.max(14, Math.min(40, tileSize * 0.52)));

  const renderItem = useCallback(
    ({ item }: { item: Row }) => (
      <TouchableOpacity
        style={[tileStyles.tile, { width: tileSize, height: tileSize }]}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('ItemDetail', { item })}
      >
        <ItemIcon uri={item.icon} size={iconSize} fluid={item.isFluid} fluidColor={item.fluidColor} tint={item.aspectTint} />
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
    [iconSize, tileSize, navigation, colors.accent],
  );

  const numColumns = prefs.columns;
  /** 翻页模式：只渲染当前页；无限下滑模式：整份列表交给 FlatList 虚拟化 */
  const paged = prefs.mode === 'page';
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  /** 当前页要显示的物品：分页大小 = 列数 × 每页行数 */
  const pageRows = useMemo(
    () => rows.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [rows, safePage, pageSize],
  );
  const listData = paged ? pageRows : rows;

  /** 固定行高：无限下滑时 FlatList 靠它准确计算总高度（一键到底/回顶不会差一截）。
   *  注意 FlatList 的 numColumns 会把每行合成一个虚拟项，getItemLayout 拿到的是**行号**，
   *  不要再除以列数（否则总高度只有真实值的 1/列数，scrollToOffset 会被截断）。 */
  const rowHeight = tileSize + spacing.s;
  const getItemLayout = useCallback(
    (_: any, rowIndex: number) => ({
      length: rowHeight,
      offset: spacing.m + rowIndex * rowHeight,
      index: rowIndex,
    }),
    [rowHeight],
  );

  // 换了筛选/排序/每页容量就回第一页，否则可能停在一个已经不存在的页码上
  useEffect(() => {
    setPage(0);
  }, [kwApplied, kinds, sortKey, sortAsc, showAll, prefs.columns, prefs.rows, prefs.mode]);

  // 翻页/跳页/改筛选后回到当前页顶部（列表会换成另一批数据，滚动位置不能停在上一页）
  useEffect(() => {
    if (!paged) return;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [safePage, paged, kwApplied, kinds, sortKey, sortAsc, showAll, prefs.columns, prefs.rows]);

  const openJump = () => {
    setJumpText(String(safePage + 1));
    setJumpOpen(true);
  };

  const doJump = () => {
    const n = parseInt(jumpText.trim(), 10);
    if (Number.isFinite(n)) setPage(Math.max(0, Math.min(pageCount - 1, n - 1)));
    setJumpOpen(false);
  };

  const scrollTop = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });
  const scrollBottom = () => {
    const totalRows = Math.ceil(rows.length / numColumns);
    const height = spacing.m * 2 + totalRows * tileSize + Math.max(0, totalRows - 1) * spacing.s;
    listRef.current?.scrollToOffset({ offset: height, animated: true });
  };

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
        <View style={{ flexDirection: 'row', gap: spacing.s }}>
          <TouchableOpacity onPress={() => navigation.navigate('Layout')} style={styles.iconBtn} hitSlop={6}>
            <Ionicons name="grid-outline" size={19} color={colors.textDim} />
          </TouchableOpacity>
          <TouchableOpacity onPress={connect} style={styles.iconBtn}>
            <Ionicons name="refresh" size={20} color={connected ? colors.textDim : colors.accent} />
          </TouchableOpacity>
        </View>
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

      {/* 类型行：物品 / 流体 / 源质 各自独立开关（和下面的「可合成」并列，互不冲突） */}
      <View style={styles.filterRow}>
        {(
          [
            ['item', 'cube', '物品'],
            ['fluid', 'water', '流体'],
            ['essentia', 'flask', '源质'],
          ] as const
        ).map(([key, icon, label]) => {
          const on = kinds[key];
          return (
            <TouchableOpacity
              key={key}
              style={[styles.segBtn, on && styles.segBtnActive]}
              onPress={() => setKinds((prev) => ({ ...prev, [key]: !prev[key] }))}
            >
              <Ionicons name={icon} size={13} color={on ? colors.accent : colors.textDim} />
              <Text style={[styles.segText, on && { color: colors.accent }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={styles.segBtn}
          onPress={() => {
            const all = kinds.item && kinds.fluid && kinds.essentia;
            // 全开时收窄到「只看物品」，否则回到全选（不能把三个都设成 !all，那样一个都不剩）
            setKinds(
              all
                ? { item: true, fluid: false, essentia: false }
                : { item: true, fluid: true, essentia: true },
            );
          }}
        >
          <Text style={styles.segText}>{kinds.item && kinds.fluid && kinds.essentia ? '只看物品' : '全选'}</Text>
        </TouchableOpacity>
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
        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            key={`grid-${numColumns}-${prefs.mode}`}
            style={{ flex: 1 }}
            data={listData}
            numColumns={numColumns}
            keyExtractor={(r) => r.key}
            renderItem={renderItem}
            contentContainerStyle={{ padding: spacing.m, gap: spacing.s }}
            columnWrapperStyle={{ gap: spacing.s }}
            getItemLayout={getItemLayout}
            initialNumToRender={40}
            maxToRenderPerBatch={40}
            windowSize={7}
            removeClippedSubviews
            ListFooterComponent={
              !paged && rows.length > 0 ? <Text style={styles.listEnd}>共 {rows.length} 个物品 · 已经到底了</Text> : null
            }
          />
          {paged && pageCount > 1 ? (
            <View style={styles.pager}>
              <TouchableOpacity
                style={[styles.pageBtn, safePage === 0 && styles.pageBtnOff]}
                disabled={safePage === 0}
                onPress={() => setPage(Math.max(0, safePage - 1))}
              >
                <Ionicons name="chevron-back" size={16} color={colors.textDim} />
              </TouchableOpacity>
              {/* 点页码弹出跳页输入框 */}
              <TouchableOpacity style={styles.jumpBtn} onPress={openJump} hitSlop={6}>
                <Text style={styles.pageText}>
                  第 {safePage + 1} / {pageCount} 页 · 共 {rows.length} 个
                </Text>
                <Ionicons name="chevron-down" size={12} color={colors.textFaint} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pageBtn, safePage >= pageCount - 1 && styles.pageBtnOff]}
                disabled={safePage >= pageCount - 1}
                onPress={() => setPage(Math.min(pageCount - 1, safePage + 1))}
              >
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              </TouchableOpacity>
            </View>
          ) : null}
          {/* 无限下滑：右下角一键回顶 / 到底（超过两行才值得显示） */}
          {!paged && rows.length > numColumns * 2 ? (
            <View style={styles.floatCol}>
              <TouchableOpacity style={styles.floatBtn} onPress={scrollTop} activeOpacity={0.75}>
                <Ionicons name="arrow-up" size={19} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.floatBtn} onPress={scrollBottom} activeOpacity={0.75}>
                <Ionicons name="arrow-down" size={19} color={colors.text} />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      )}

      {/* 跳页弹层 */}
      <Modal visible={jumpOpen} transparent animationType="fade" onRequestClose={() => setJumpOpen(false)}>
        <View style={styles.modalMask}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setJumpOpen(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>跳转到页码</Text>
            <Text style={styles.modalHint}>
              输入 1 – {pageCount} 之间的页码，当前是第 {safePage + 1} 页
            </Text>
            <TextInput
              style={styles.modalInput}
              value={jumpText}
              onChangeText={setJumpText}
              keyboardType="number-pad"
              autoFocus
              selectTextOnFocus
              placeholder={`1 – ${pageCount}`}
              placeholderTextColor={colors.textFaint}
              onSubmitEditing={doJump}
              returnKeyType="go"
            />
            <View style={{ flexDirection: 'row', gap: spacing.s }}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setJumpOpen(false)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalOk]} onPress={doJump}>
                <Text style={styles.modalOkText}>跳转</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = themedStyles((colors) => ({
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
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.m,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  pageBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pageBtnOff: { opacity: 0.35 },
  pageText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  jumpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.m,
    paddingVertical: 8,
    borderRadius: radius.m,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  floatCol: {
    position: 'absolute',
    right: spacing.l,
    bottom: spacing.l,
    gap: spacing.s,
  },
  floatBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  listEnd: { color: colors.textFaint, fontSize: 11, textAlign: 'center', paddingVertical: spacing.l },
  modalMask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 330,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.l,
    gap: spacing.m,
  },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  modalHint: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  modalInput: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.m,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: spacing.m,
    paddingVertical: 10,
    textAlign: 'center',
  },
  modalBtn: { flex: 1, borderRadius: radius.m, paddingVertical: 11, alignItems: 'center' },
  modalCancel: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  modalCancelText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  modalOk: { backgroundColor: colors.accent },
  modalOkText: { color: colors.bg, fontSize: 14, fontWeight: '700' },
}));

const tileStyles = themedStyles((colors) => ({
  tile: {
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
    backgroundColor: colors.isDark ? 'rgba(11,14,20,0.85)' : 'rgba(255,255,255,0.9)',
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
}));
