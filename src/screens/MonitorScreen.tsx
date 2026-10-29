// 服务器监控：TPS / MSPT 总览 + 逐世界检测。
//
// 数据分两路（见 AEMobile/doc/传输协议与安全.md §4/§5）：
//   1) 一次性请求 op "tps"：91 个维度的名字/人数/实体/区块 + 全服快照，约 7KB。**进页面拉一次**，
//      每 60 秒刷新一次人数；点开新世界时也顺手拉一次。
//   2) 订阅 op "tps"（5 秒一帧）：只带「被检测维度」的 tick 数字，约 200B。
// 之所以拆开：91 个维度每帧带全量清单 = 6KB/帧 = 4MB/小时，手机上纯浪费流量。
//
// 「点开才检测」= 订阅参数 dims 里只有主世界 + 用户点开过的世界；关掉页面立刻断流。
// 曲线历史只在客户端：内存最多 180 点（15 分钟 @5s），落盘一份供下次打开续看。
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useConfig } from '../config';
import { openStream, request } from '../api';
import type { TpsFrame, TpsFull, TpsSrv, TpsWorldMeta, TpsWorldTick } from '../api';
import type { Stream } from '../net/conn';
import { formatAgo, readCache, scopeKey, writeCache } from '../cache';
import { themedStyles, useTheme, Palette, radius, spacing, card } from '../theme';
import { Chip, ProgressBar, Segmented, StatusDot } from '../components';
import { ChartRange, useMonitorPrefs, WorldFilter } from '../monitorprefs';

/**
 * 曲线本身懒加载：echarts 一进启动路径就会常驻（实测多占 ~60MB）。
 * 只有真的收到数据时才把 MonitorChart 拉进来。
 */
const MonitorChart = React.lazy(() => import('./MonitorChart'));

/** 15 分钟 @ 5 秒 */
const MAX_POINTS = 180;
/** 相邻两点间隔超过这个值就插一个断档（页面切走过 / App 被杀过），曲线不连线 */
const GAP_MS = 15000;
/** 服务端硬编码的推送间隔，只用于文案 */
const PUSH_SECONDS = 5;
/** 世界清单（人数/实体/区块）的刷新间隔 */
const META_REFRESH_MS = 60000;

type Pt = { t: number; v: number; max: number };
type Series = (Pt | null)[];

/** 落盘的快照：关掉 App 再打开能看到上次的走势和世界列表，而不是空页面 */
interface MonitorSnapshot {
  srv: TpsSrv | null;
  srvSeries: Series;
  meta: TpsWorldMeta[];
  metaAt: number;
}

function msptColor(v: number, c: Palette): string {
  if (v < 30) return c.ok;
  if (v < 50) return c.warn;
  return c.bad;
}

function tpsColor(v: number, c: Palette): string {
  if (v >= 19.5) return c.ok;
  if (v >= 17) return c.warn;
  return c.bad;
}

/** 由 mspt 折算 TPS，口径和服务端一致（50ms 以内都是满速） */
function tpsOf(mspt: number): number {
  if (mspt <= 0) return 0;
  return mspt <= 50 ? 20 : 1000 / mspt;
}

function verdict(mspt: number): string {
  if (mspt <= 0) return '等待数据';
  if (mspt < 25) return '流畅';
  if (mspt < 45) return '轻微卡顿';
  if (mspt < 60) return '卡顿';
  return '严重卡顿';
}

function lastOf(series: Series): Pt | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const p = series[i];
    if (p) return p;
  }
  return null;
}

/** 追加一个点：间隔太大先插断档，同时间戳则覆盖，超长截断 */
function pushPoint(series: Series, p: Pt): Series {
  const out = series.slice();
  const last = lastOf(out);
  if (last && p.t === last.t) {
    out[out.length - 1] = p;
    return out;
  }
  if (last && p.t - last.t > GAP_MS) out.push(null);
  out.push(p);
  return out.length > MAX_POINTS ? out.slice(out.length - MAX_POINTS) : out;
}

function clockOf(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export default function MonitorScreen() {
  const { colors } = useTheme();
  const { config } = useConfig();
  const insets = useSafeAreaInsets();
  const [prefs, setPrefs] = useMonitorPrefs();

  const [meta, setMeta] = useState<TpsWorldMeta[]>([]);
  const [metaAt, setMetaAt] = useState(0);
  const [ticks, setTicks] = useState<Record<number, TpsWorldTick>>({});
  const [srv, setSrv] = useState<TpsSrv | null>(null);
  const [srvSeries, setSrvSeries] = useState<Series>([]);
  const [worldSeries, setWorldSeries] = useState<Record<number, Series>>({});
  const [lags, setLags] = useState<{ t: number; max: number }[]>([]);
  const [connected, setConnected] = useState(false);
  /** 服务端 mod 太旧（没有 tps op） */
  const [unavailable, setUnavailable] = useState(false);
  /** 曲线来自缓存的写入时间；收到实时帧后清空 */
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [metric, setMetric] = useState<'mspt' | 'tps'>('mspt');
  /** 91 个维度一次全渲染会卡：默认只画前 25 行，点一下再看全部 */
  const [showAll, setShowAll] = useState(false);

  const srvRef = useRef<Series>([]);
  /** apply 里要读最新的曲线/清单，但不想让它们进依赖（否则每帧重建回调 → 重新订阅） */
  const worldSeriesRef = useRef<Record<number, Series>>({});
  const metaRef = useRef<TpsWorldMeta[]>([]);
  const metaAtRef = useRef(0);
  const cacheKey = `tps:${scopeKey(config)}`;
  const mainDim = config.mainnet?.dimid ?? 0;

  // 主世界 + 用户点开过的世界。主世界永远在内（config 里监控器所在的维度）
  const dims = useMemo(() => {
    const set = new Set<number>([mainDim, ...prefs.tracked]);
    return Array.from(set).sort((a, b) => a - b);
  }, [mainDim, prefs.tracked]);
  const dimsKey = dims.join(',');
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  const trackedSet = useMemo(() => new Set<number>(dims), [dimsKey]);

  // 先铺上次的曲线和世界列表，实时帧到了再往后接
  useEffect(() => {
    let alive = true;
    readCache<MonitorSnapshot>(cacheKey).then((hit) => {
      if (!alive || !hit) return;
      if (Date.now() - hit.at > 15 * 60 * 1000) return;
      if (hit.data.srvSeries?.length) {
        srvRef.current = hit.data.srvSeries;
        setSrvSeries(hit.data.srvSeries);
      }
      if (hit.data.srv) setSrv(hit.data.srv);
      if (hit.data.meta?.length) {
        setMeta(hit.data.meta);
        setMetaAt(hit.data.metaAt ?? 0);
      }
      setCachedAt(hit.at);
    });
    return () => {
      alive = false;
    };
  }, [cacheKey]);

  /** 拉一次世界清单 + 全服快照（约 7KB，进页面/每 60 秒/点开新世界时各一次） */
  const loadMeta = useCallback(async () => {
    if (!config.ip) return;
    try {
      const r = await request<TpsFull>(config, 'tps', { dims: dimsRef.current });
      if (!r.succeed || !r.body) {
        const msg = String(r.message ?? '');
        if (msg.includes('UNKNOWN_OP') || msg.includes('NOT_SUPPORTED')) setUnavailable(true);
        return;
      }
      setUnavailable(false);
      setMeta(r.body.w);
      setMetaAt(r.body.ts);
      setSrv(r.body.srv);
      // 顺手把这次带回来的 tick 数据塞进去，页面刚打开就有数（不用等第一帧）
      const seeded: Record<number, TpsWorldTick> = {};
      for (const w of r.body.w) {
        if (w.mspt == null) continue;
        seeded[w.id] = { id: w.id, mspt: w.mspt, max: w.max ?? w.mspt, tps: w.tps ?? tpsOf(w.mspt), ticks: w.ticks ?? 0 };
      }
      if (Object.keys(seeded).length) setTicks((prev) => ({ ...prev, ...seeded }));
    } catch {
      // 网络抖动：等下一次定时刷新
    }
  }, [config]);

  const apply = useCallback(
    (f: TpsFrame) => {
      const t = f.ts || Date.now();
      setSrv(f.srv);
      setConnected(true);
      setCachedAt(null);

      const pt: Pt = { t, v: f.srv.mspt, max: f.srv.max };
      setSrvSeries((prev) => {
        const next = pushPoint(prev, pt);
        srvRef.current = next;
        return next;
      });

      if (f.w.length) {
        const patch: Record<number, TpsWorldTick> = {};
        const series: Record<number, Series> = { ...worldSeriesRef.current };
        for (const w of f.w) {
          patch[w.id] = w;
          series[w.id] = pushPoint(series[w.id] ?? [], { t, v: w.mspt, max: w.max });
        }
        worldSeriesRef.current = series;
        setTicks((prev) => ({ ...prev, ...patch }));
        setWorldSeries(series);
      }

      // 窗口内最差的那一 tick 超过 50ms 就算一次卡顿，最多留 5 条
      if (f.srv.max > 50) {
        setLags((prev) => [{ t, max: f.srv.max }, ...prev].slice(0, 5));
      }

      // 5 秒一帧，限 30 秒一次写盘：缓存只用于下次打开时还原走势
      writeCache<MonitorSnapshot>(
        cacheKey,
        { srv: f.srv, srvSeries: srvRef.current, meta: metaRef.current, metaAt: metaAtRef.current },
        30000,
      );
    },
    [cacheKey],
  );

  // 每帧把最新值同步到 ref（不触发渲染）
  worldSeriesRef.current = worldSeries;
  metaRef.current = meta;
  metaAtRef.current = metaAt;

  // 只在页面可见时订阅 + 定时刷新清单；切走立刻断流（服务端就不推了）
  useFocusEffect(
    useCallback(() => {
      if (!config.ip) return;
      loadMeta();
      const timer = setInterval(loadMeta, META_REFRESH_MS);

      let stream: Stream | null = null;
      try {
        stream = openStream(config, 'tps', { dims: dimsRef.current });
      } catch {
        setConnected(false);
        return () => clearInterval(timer);
      }
      const s = stream;
      const onMessage = (ev: any) => {
        const f = ev?.data as TpsFrame | undefined;
        if (!f || f.t !== 'f' || !f.srv) return;
        apply(f);
      };
      const onError = (ev: any) => {
        setConnected(false);
        const msg = String(ev?.message ?? '');
        // 老版本 mod 会回 UNKNOWN_STREAM:tps
        if (msg.includes('UNKNOWN_STREAM') || msg.includes('NOT_SUPPORTED')) setUnavailable(true);
      };
      s.addEventListener('message', onMessage);
      s.addEventListener('error', onError);

      return () => {
        clearInterval(timer);
        s.removeEventListener?.('message', onMessage);
        s.removeEventListener?.('error', onError);
        s.close();
        setConnected(false);
      };
    }, [config, dimsKey, apply, loadMeta]),
  );

  /** 世界清单 + tick 数据合到一行 */
  const rows = useMemo(
    () => meta.map((m) => ({ ...m, tick: ticks[m.id] as TpsWorldTick | undefined, tracked: trackedSet.has(m.id) })),
    [meta, ticks, trackedSet],
  );

  const worlds = useMemo(() => {
    const list = rows.filter((w) =>
      prefs.filter === 'personal' ? w.pm === 1 : prefs.filter === 'occupied' ? w.p > 0 : true,
    );
    // 已检测的永远排在未检测的前面，组内按 mspt 排；未检测的按人数/家园/维度号排，免得乱跳
    list.sort((a, b) => {
      const at = a.tick ? 1 : 0;
      const bt = b.tick ? 1 : 0;
      if (at !== bt) return bt - at;
      if (at === 1) {
        const av = a.tick!.mspt;
        const bv = b.tick!.mspt;
        if (av !== bv) return prefs.sort === 'desc' ? bv - av : av - bv;
      } else {
        if (a.p !== b.p) return b.p - a.p;
        if (a.pm !== b.pm) return b.pm - a.pm;
      }
      return a.id - b.id;
    });
    return list;
  }, [rows, prefs.filter, prefs.sort]);

  const maxMspt = useMemo(() => {
    let m = 0;
    for (const w of worlds) if (w.tick && w.tick.mspt > m) m = w.tick.mspt;
    return m;
  }, [worlds]);

  /** 当前曲线画谁：null = 全服 */
  const viewDim = prefs.expanded;
  const viewWorld = useMemo(
    () => (viewDim == null ? null : meta.find((w) => w.id === viewDim) ?? null),
    [meta, viewDim],
  );

  const chartPoints = useMemo(() => {
    const src = viewDim == null ? srvSeries : worldSeries[viewDim] ?? [];
    const span = prefs.range === '5m' ? 5 * 60 * 1000 : 15 * 60 * 1000;
    const cutoff = Date.now() - span;
    const out: (Pt | null)[] = [];
    let started = false;
    for (const p of src) {
      if (p == null) {
        if (started) out.push(null);
        continue;
      }
      if (p.t < cutoff) continue;
      started = true;
      out.push({
        t: p.t,
        v: metric === 'tps' ? tpsOf(p.v) : p.v,
        max: metric === 'tps' ? tpsOf(p.max) : p.max,
      });
    }
    return out;
  }, [srvSeries, worldSeries, viewDim, prefs.range, metric]);

  // 卡片左右各有 margin + padding，图表宽度按屏幕实宽算，别写死
  const chartWidth = Math.max(200, Math.min(Dimensions.get('window').width - spacing.l * 4 - 2, 560));
  /** 图表上方两个分段控件的宽度（各占一半，留出 gap） */
  const segWidth = (chartWidth - spacing.s) / 2;

  const onRow = useCallback(
    (w: TpsWorldMeta) => {
      if (!trackedSet.has(w.id)) {
        // 点开检测：加入订阅，并把曲线切到这个世界
        setPrefs({
          tracked: [...prefs.tracked.filter((id) => id !== mainDim), w.id],
          expanded: w.id,
        });
        return;
      }
      setPrefs({ expanded: prefs.expanded === w.id ? null : w.id });
    },
    [mainDim, prefs.tracked, prefs.expanded, setPrefs, trackedSet],
  );

  const statusText = unavailable
    ? '服务端 mod 需 3.1.0+'
    : connected
    ? `实时 · 每 ${PUSH_SECONDS} 秒`
    : cachedAt
    ? `缓存 · ${formatAgo(cachedAt)}`
    : '连接中…';

  const srvMspt = srv?.mspt ?? 0;
  const srvTps = srv?.tps ?? 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
      <View style={[styles.header, { paddingTop: spacing.l + insets.top }]}>
        <View>
          <Text style={styles.title}>服务器监控</Text>
          <View style={styles.statusRow}>
            <StatusDot ok={connected} />
            <Text style={styles.subtitle}>{statusText}</Text>
          </View>
        </View>
        <Chip label={`每 ${PUSH_SECONDS} 秒`} tone="neutral" icon="time-outline" />
      </View>

      {/* ---------------- 总览 ---------------- */}
      <View style={[card, styles.card]}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.metricLabel}>TPS</Text>
            <Text style={[styles.bigValue, { color: srvTps ? tpsColor(srvTps, colors) : colors.textFaint }]}>
              {srvTps ? srvTps.toFixed(2) : '--'}
            </Text>
            <Text style={[styles.hint, { color: srvMspt ? msptColor(srvMspt, colors) : colors.textFaint }]}>
              {verdict(srvMspt)}
            </Text>
          </View>
          <View style={styles.vDivider} />
          <View style={{ flex: 1 }}>
            <Text style={styles.metricLabel}>MSPT</Text>
            <Text style={[styles.bigValue, { color: srvMspt ? msptColor(srvMspt, colors) : colors.textFaint }]}>
              {srvMspt ? srvMspt.toFixed(1) : '--'}
              <Text style={styles.unit}>ms</Text>
            </Text>
            <Text style={styles.hint}>
              峰值 {srv?.max ? srv.max.toFixed(0) : '--'}ms · {srv?.players ?? 0} 人在线
            </Text>
          </View>
        </View>

        <View style={styles.chartBar}>
          {/* ⚠️ 宽度直接给 Segmented（它有 style），别套 flex:1 的 View —— 包裹层高度会是 0，点不动 */}
          <Segmented
            style={{ width: segWidth }}
            options={[
              { key: 'mspt', label: 'MSPT' },
              { key: 'tps', label: 'TPS' },
            ]}
            value={metric}
            onChange={(k) => setMetric(k as 'mspt' | 'tps')}
          />
          <Segmented
            style={{ width: segWidth }}
            options={[
              { key: '5m', label: '5 分钟' },
              { key: '15m', label: '15 分钟' },
            ]}
            value={prefs.range}
            onChange={(k) => setPrefs({ range: k as ChartRange })}
          />
        </View>

        <View style={{ marginTop: spacing.s }}>
          {chartPoints.length > 0 ? (
            <Suspense fallback={<View style={{ height: 170 }} />}>
              <MonitorChart
                points={chartPoints}
                unit={metric}
                threshold={metric === 'mspt' ? 50 : undefined}
                width={chartWidth}
              />
            </Suspense>
          ) : (
            <View style={styles.chartEmpty}>
              <Text style={styles.emptyText}>{unavailable ? '服务端还没接入 tick 数据' : '等待数据…'}</Text>
            </View>
          )}
        </View>

        <View style={styles.chartFoot}>
          <Ionicons name={viewDim == null ? 'globe-outline' : 'earth-outline'} size={12} color={colors.textFaint} />
          <Text style={styles.chartFootText} numberOfLines={1}>
            {viewDim == null ? '全服' : viewWorld?.d ?? `DIM${viewDim}`}
          </Text>
          {viewDim == null ? null : (
            <TouchableOpacity onPress={() => setPrefs({ expanded: null })}>
              <Text style={[styles.chartFootLink, { color: colors.accent }]}>切回全服</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ---------------- 世界列表 ---------------- */}
      <View style={[card, styles.card]}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>世界</Text>
          <TouchableOpacity
            style={styles.sortBtn}
            onPress={() => setPrefs({ sort: prefs.sort === 'desc' ? 'asc' : 'desc' })}
          >
            <Ionicons
              name={prefs.sort === 'desc' ? 'arrow-down-outline' : 'arrow-up-outline'}
              size={13}
              color={colors.textDim}
            />
            <Text style={styles.sortText}>{prefs.sort === 'desc' ? '高 → 低' : '低 → 高'}</Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: spacing.s }}>
          <Segmented
            options={[
              { key: 'all', label: '全部' },
              { key: 'personal', label: '只看家园' },
              { key: 'occupied', label: '有人的' },
            ]}
            value={prefs.filter}
            onChange={(k) => setPrefs({ filter: k as WorldFilter })}
          />
        </View>

        {worlds.length === 0 ? (
          <Text style={[styles.emptyText, { marginTop: spacing.m }]}>
            {meta.length ? '这个筛选条件下没有世界' : '等待服务端数据…'}
          </Text>
        ) : (
          (showAll ? worlds : worlds.slice(0, 25)).map((w) => {
            const t = w.tick;
            const active = prefs.expanded === w.id;
            const bar = t && maxMspt > 0 ? t.mspt / maxMspt : 0;
            return (
              <TouchableOpacity
                key={w.id}
                activeOpacity={0.7}
                onPress={() => onRow(w)}
                style={[styles.row, active && { backgroundColor: colors.surfaceAlt }]}
              >
                <View style={styles.rowTop}>
                  <View style={[styles.dot, { backgroundColor: t ? msptColor(t.mspt, colors) : colors.border }]} />
                  <Text style={styles.rowName} numberOfLines={1}>
                    {w.d}
                  </Text>
                  {w.pm === 1 ? <Chip label="家园" tone="accent2" /> : null}
                  <View style={{ flex: 1 }} />
                  {t ? (
                    <>
                      <Text style={[styles.rowTps, { color: tpsColor(t.tps, colors) }]}>{t.tps.toFixed(2)}</Text>
                      <Text style={[styles.rowMspt, { color: msptColor(t.mspt, colors) }]}>
                        {t.mspt.toFixed(1)}ms
                      </Text>
                    </>
                  ) : w.tracked ? (
                    <Text style={styles.rowDetect}>等待…</Text>
                  ) : (
                    <Text style={styles.rowDetect}>点开检测</Text>
                  )}
                </View>
                <View style={styles.rowSubLine}>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {w.n && w.n !== w.d ? `${w.n} · ` : ''}
                    {w.p} 人 · {w.e} 实体 · {w.c} 区块
                  </Text>
                </View>
                {t ? <ProgressBar ratio={bar} tone={msptColor(t.mspt, colors)} height={3} /> : null}
              </TouchableOpacity>
            );
          })
        )}

        {worlds.length > 25 ? (
          <TouchableOpacity style={styles.moreBtn} onPress={() => setShowAll((v) => !v)}>
            <Text style={[styles.moreText, { color: colors.accent }]}>
              {showAll ? '收起' : `还有 ${worlds.length - 25} 个世界，展开`}
            </Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.footnote}>
          世界的 TPS 是按该世界每 tick 耗时折算的：20.00 表示它不是瓶颈。默认只检测主世界，其他世界点开才开始检测。
          {metaAt ? ` 列表更新于 ${formatAgo(metaAt)}。` : ''}
        </Text>
      </View>

      {/* ---------------- 卡顿记录 ---------------- */}
      {lags.length > 0 ? (
        <View style={[card, styles.card]}>
          <Text style={styles.cardTitle}>最近卡顿</Text>
          {lags.map((l) => (
            <View key={l.t} style={styles.lagRow}>
              <Text style={styles.lagTime}>{clockOf(l.t)}</Text>
              <Text style={[styles.lagValue, { color: colors.bad }]}>峰值 {l.max.toFixed(0)}ms</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.lagHint}>单 tick 超过 50ms</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[card, styles.card]}>
        <Text style={styles.cardTitle}>服务器</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, marginTop: spacing.s }}>
          <Chip label={`${config.ip}:${config.port}`} tone="accent" icon="server-outline" />
          {config.mainnet ? (
            <Chip
              label={`主世界 DIM${config.mainnet.dimid} (${config.mainnet.x}, ${config.mainnet.y}, ${config.mainnet.z})`}
              tone="neutral"
              icon="location-outline"
            />
          ) : null}
        </View>
      </View>
    </ScrollView>
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  subtitle: { color: colors.textFaint, fontSize: 11 },
  card: { marginHorizontal: spacing.l, marginBottom: spacing.m, padding: spacing.l },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  metricLabel: { color: colors.textFaint, fontSize: 10, letterSpacing: 1 },
  bigValue: { fontSize: 30, fontWeight: '800', marginTop: 2 },
  unit: { fontSize: 13, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  vDivider: { width: 1, backgroundColor: colors.border, marginHorizontal: spacing.m },
  chartBar: {
    flexDirection: 'row',
    marginTop: spacing.m,
    gap: spacing.s,
  },
  chartEmpty: { height: 170, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textFaint, fontSize: 12 },
  chartFoot: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.s },
  chartFootText: { color: colors.textFaint, fontSize: 11, flexShrink: 1 },
  chartFootLink: { fontSize: 11, fontWeight: '700', marginLeft: spacing.s },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.s,
    paddingVertical: 4,
    borderRadius: radius.s,
    backgroundColor: colors.surfaceAlt,
  },
  sortText: { color: colors.textDim, fontSize: 11 },
  row: {
    marginTop: spacing.s,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.s,
    borderRadius: radius.m,
    gap: 3,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  rowName: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  rowTps: { fontSize: 13, fontWeight: '800' },
  rowMspt: { fontSize: 12, fontWeight: '700', marginLeft: spacing.s },
  rowDetect: { color: colors.textFaint, fontSize: 11 },
  rowSubLine: { flexDirection: 'row', alignItems: 'center', marginLeft: 13 },
  rowSub: { color: colors.textFaint, fontSize: 10 },
  footnote: { color: colors.textFaint, fontSize: 10, lineHeight: 16, marginTop: spacing.m },
  moreBtn: { alignItems: 'center', paddingVertical: spacing.s, marginTop: spacing.xs },
  moreText: { fontSize: 12, fontWeight: '700' },
  lagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginTop: spacing.s },
  lagTime: { color: colors.textDim, fontSize: 12 },
  lagValue: { fontSize: 12, fontWeight: '700' },
  lagHint: { color: colors.textFaint, fontSize: 10 },
}));
