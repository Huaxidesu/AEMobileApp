// 服务器监控：MSPT 实时曲线 + 服务器信息
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConfig } from '../config';
import { openStream, request } from '../api';
import type { Stream } from '../net/conn';
import { formatAgo, readCache, scopeKey, writeCache } from '../cache';
import { themedStyles, useTheme, Palette, radius, spacing, card } from '../theme';
import { Chip, StatusDot } from '../components';

/**
 * 曲线本身懒加载：echarts 一进启动路径就会常驻（实测多占 ~60MB）。
 * 只有真的收到 tick 数据时才把 MonitorChart 拉进来。
 */
const MonitorChart = React.lazy(() => import('./MonitorChart'));
type MsptPoint = { label: string; m5: number; m30: number; m300: number };

const MAX_POINTS = 120;

/** 落盘的曲线快照：关掉 App 再打开能看到上次的走势，而不是空图 */
interface MonitorSnapshot {
  s5: [string, number][];
  s30: [string, number][];
  s300: [string, number][];
  latest: [number, number, number];
}

function msptColor(v: number, colors: Palette): string {
  if (v < 30) return colors.ok;
  if (v < 50) return colors.warn;
  return colors.bad;
}

export default function MonitorScreen() {
  const { colors } = useTheme();
  const { config } = useConfig();
  const insets = useSafeAreaInsets();
  const [connected, setConnected] = useState(false);
  const [latest, setLatest] = useState<[number, number, number]>([0, 0, 0]);
  /** 曲线来自缓存的写入时间；收到实时帧后清空 */
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  /** 服务端没有 /api/serverMSPT（本 mod 已移除该功能，等独立插件） */
  const [unavailable, setUnavailable] = useState(false);
  const series5 = useRef<[string, number][]>([]);
  const series30 = useRef<[string, number][]>([]);
  const series300 = useRef<[string, number][]>([]);
  /** 曲线的渲染数据；为空说明还没收到过 tick，此时不加载 echarts */
  const [points, setPoints] = useState<MsptPoint[]>([]);
  const esRef = useRef<Stream | null>(null);

  const cacheKey = `mspt:${scopeKey(config)}`;

  // 先铺上次的曲线，实时帧到了再往后接
  useEffect(() => {
    let alive = true;
    readCache<MonitorSnapshot>(cacheKey).then((hit) => {
      if (!alive || !hit || series5.current.length > 0) return;
      series5.current = hit.data.s5 ?? [];
      series30.current = hit.data.s30 ?? [];
      series300.current = hit.data.s300 ?? [];
      setLatest(hit.data.latest ?? [0, 0, 0]);
      setPoints(
        (hit.data.s5 ?? []).map(([label, m5], i) => ({
          label,
          m5,
          m30: hit.data.s30?.[i]?.[1] ?? 0,
          m300: hit.data.s300?.[i]?.[1] ?? 0,
        })),
      );
      setCachedAt(hit.at);
    });
    return () => {
      alive = false;
    };
  }, [cacheKey]);

  const connect = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    if (!config.ip) return;

    // MSPT 已从 mod 里整体移除，等服务端插件提供。
    // 先用一次性请求探一下：服务端没有这个 op 会回 ok=false（NOT_SUPPORTED）→ 空态。
    request<any>(config, 'mspt')
      .then((resp) => {
        if (!resp.succeed) {
          setUnavailable(true);
          return;
        }
        startStream();
      })
      .catch(() => setConnected(false));

    function startStream() {
      // 将来插件的约定：订阅 mspt，推送帧 {"t":"p","d":[5s,30s,300s]}
      const es: Stream = openStream(config, 'mspt', {});
      esRef.current = es;
      es.addEventListener('message', (ev: any) => {
        const d = ev?.data?.d;
        if (!Array.isArray(d) || d.length < 3) return;
        const parts = d.map(Number);
        if (parts.some((n: number) => Number.isNaN(n))) return;
        const t = new Date();
        const label = `${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
        series5.current.push([label, parts[0]]);
        series30.current.push([label, parts[1]]);
        series300.current.push([label, parts[2]]);
        for (const s of [series5, series30, series300]) if (s.current.length > MAX_POINTS) s.current.shift();
        setLatest([parts[0], parts[1], parts[2]]);
        // 只有真的收到数据才会触发 MonitorChart 的懒加载
        setPoints(
          series5.current.map(([label, m5], i) => ({
            label,
            m5,
            m30: series30.current[i]?.[1] ?? 0,
            m300: series300.current[i]?.[1] ?? 0,
          })),
        );
        setConnected(true);
        setCachedAt(null);
        // 1s 一帧，限 30s 一次写盘：缓存只用于下次打开时还原走势
        writeCache<MonitorSnapshot>(
          cacheKey,
          {
            s5: [...series5.current],
            s30: [...series30.current],
            s300: [...series300.current],
            latest: [parts[0], parts[1], parts[2]],
          },
          30000,
        );
      });
      es.addEventListener('error', () => {
        setConnected(false);
        // 协议 3.0.0 的 mod 没有 mspt 流，订阅会被拒 → 直接进「未启用」空态
        setUnavailable(true);
        es.close();
      });
    }
  }, [config, cacheKey]);

  // 只在本页可见时订阅：MSPT 每秒一帧，长期挂着纯浪费流量和电
  useFocusEffect(
    useCallback(() => {
      connect();
      return () => {
        esRef.current?.close();
        esRef.current = null;
        setConnected(false);
      };
    }, [connect]),
  );

  const stats = useMemo(
    () =>
      [
        { label: '5s', value: latest[0] },
        { label: '30s', value: latest[1] },
        { label: '300s', value: latest[2] },
      ],
    [latest],
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: spacing.l + insets.top }]}>
        <View>
          <Text style={styles.title}>服务器监控</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <StatusDot ok={connected} />
            <Text style={styles.subtitle}>
              {unavailable
                ? '监控插件未启用'
                : connected
                ? '实时tick监控中'
                : cachedAt
                ? `缓存曲线 · ${formatAgo(cachedAt)}`
                : '连接中…'}
            </Text>
          </View>
        </View>
      </View>

      {unavailable ? (
        <View style={[card, { margin: spacing.l, padding: spacing.l, gap: spacing.s }]}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>服务器监控暂未接入</Text>
          <Text style={{ color: colors.textDim, fontSize: 12, lineHeight: 19 }}>
            当前服务器还没有提供 tick 数据。等服务器插件装好后，这一页会自动恢复曲线，App 不需要更新。
          </Text>
        </View>
      ) : (
        <View style={[card, { margin: spacing.l, padding: spacing.l }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.m }}>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>MSPT（毫秒/刻）</Text>
            <Text style={{ color: colors.textFaint, fontSize: 11 }}>50ms = 20 TPS</Text>
          </View>
          {points.length > 0 ? (
            <Suspense fallback={<View style={{ height: 200 }} />}>
              <MonitorChart points={points} />
            </Suspense>
          ) : (
            <View style={{ height: 200, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.textFaint, fontSize: 12 }}>
                {unavailable ? '未接入 tick 数据' : '等待数据…'}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: spacing.s, marginTop: spacing.m }}>
            {stats.map((s) => (
              <View key={s.label} style={[statStyles.box, { borderColor: msptColor(s.value, colors) }]}>
                <Text style={[statStyles.value, { color: msptColor(s.value, colors) }]}>{s.value ? s.value.toFixed(1) : '--'}</Text>
                <Text style={statStyles.label}>{s.label}均值</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={[card, { marginHorizontal: spacing.l, padding: spacing.l, gap: spacing.s }]}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>服务器</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s }}>
          <Chip label={`${config.ip}:${config.port}`} tone="accent" icon="server" />
          {config.mainnet ? <Chip label={`主网 DIM${config.mainnet.dimid} (${config.mainnet.x}, ${config.mainnet.y}, ${config.mainnet.z})`} tone="neutral" icon="location" /> : null}
        </View>
      </View>
    </View>
  );
}

const statStyles = themedStyles((colors) => ({
  box: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.s,
    borderRadius: radius.m,
    borderWidth: 1,
    backgroundColor: colors.surfaceAlt,
  },
  value: { fontSize: 17, fontWeight: '800' },
  label: { color: colors.textFaint, fontSize: 10, marginTop: 2 },
}));

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
  refresh: {
    width: 38,
    height: 38,
    borderRadius: radius.m,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
}));
