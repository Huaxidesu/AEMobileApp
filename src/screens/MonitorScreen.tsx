// 服务器监控：MSPT 实时曲线 + 服务器信息
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import EventSource from 'react-native-sse';
import { useFocusEffect } from '@react-navigation/native';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TitleComponent } from 'echarts/components';
import { SVGRenderer, SvgChart } from '@wuba/react-native-echarts';
import { useConfig } from '../config';
import { colors, radius, spacing, card } from '../theme';
import { Chip, StatusDot } from '../components';

echarts.use([SVGRenderer, LineChart, GridComponent, LegendComponent, TitleComponent]);

const MAX_POINTS = 120;

function msptColor(v: number): string {
  if (v < 30) return colors.ok;
  if (v < 50) return colors.warn;
  return colors.bad;
}

export default function MonitorScreen() {
  const { config } = useConfig();
  const [connected, setConnected] = useState(false);
  const [latest, setLatest] = useState<[number, number, number]>([0, 0, 0]);
  const series5 = useRef<[string, number][]>([]);
  const series30 = useRef<[string, number][]>([]);
  const series300 = useRef<[string, number][]>([]);
  const skiaRef = useRef<any>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    esRef.current?.close();
    const es: EventSource = new EventSource(`${config.scheme}://${config.ip}:${config.port}/api/serverMSPT`);
    esRef.current = es;
    es.addEventListener('message', (ev: any) => {
      const parts = String(ev.data).split(',').map(Number);
      if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return;
      const t = new Date();
      const label = `${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
      series5.current.push([label, parts[0]]);
      series30.current.push([label, parts[1]]);
      series300.current.push([label, parts[2]]);
      for (const s of [series5, series30, series300]) if (s.current.length > MAX_POINTS) s.current.shift();
      setLatest([parts[0], parts[1], parts[2]]);
      setConnected(true);
    });
    es.addEventListener('error', () => setConnected(false));
  }, [config]);

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

  // 初始化图表
  const chartW = Math.min(Dimensions.get('window').width - spacing.l * 2 - spacing.l * 2, 340);
  const chartH = 200;
  useEffect(() => {
    if (!skiaRef.current) return;
    const chart = echarts.init(skiaRef.current, 'dark', {
      renderer: 'svg',
      width: chartW,
      height: chartH,
    });
    chart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 36, right: 12, top: 16, bottom: 22 },
      xAxis: { type: 'category', axisLabel: { color: colors.textFaint, fontSize: 9 }, axisLine: { lineStyle: { color: colors.border } } },
      yAxis: { type: 'value', min: 0, axisLabel: { color: colors.textFaint, fontSize: 9 }, splitLine: { lineStyle: { color: colors.border } } },
      legend: { show: false },
      series: [
        { name: '5s', type: 'line', smooth: true, showSymbol: false, data: [], lineStyle: { color: colors.accent, width: 2 } },
        { name: '30s', type: 'line', smooth: true, showSymbol: false, data: [], lineStyle: { color: colors.accent2, width: 1.5 } },
        { name: '300s', type: 'line', smooth: true, showSymbol: false, data: [], lineStyle: { color: colors.textFaint, width: 1 } },
      ],
    });
    chartRef.current = chart;
    return () => {
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // 每秒把缓冲刷进图表（同样只在可见时跑）
  useFocusEffect(
    useCallback(() => {
      const t = setInterval(() => {
        chartRef.current?.setOption({
          series: [
            { data: series5.current },
            { data: series30.current },
            { data: series300.current },
          ],
        });
      }, 1000);
      return () => clearInterval(t);
    }, []),
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
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>服务器监控</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <StatusDot ok={connected} />
            <Text style={styles.subtitle}>{connected ? '实时tick监控中' : '连接中…'}</Text>
          </View>
        </View>
      </View>

      <View style={[card, { margin: spacing.l, padding: spacing.l }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.m }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>MSPT（毫秒/刻）</Text>
          <Text style={{ color: colors.textFaint, fontSize: 11 }}>50ms = 20 TPS</Text>
        </View>
        <SvgChart ref={skiaRef} style={{ alignSelf: 'center' }} />
        <View style={{ flexDirection: 'row', gap: spacing.s, marginTop: spacing.m }}>
          {stats.map((s) => (
            <View key={s.label} style={[statStyles.box, { borderColor: msptColor(s.value) }]}>
              <Text style={[statStyles.value, { color: msptColor(s.value) }]}>{s.value ? s.value.toFixed(1) : '--'}</Text>
              <Text style={statStyles.label}>{s.label}均值</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[card, { marginHorizontal: spacing.l, padding: spacing.l, gap: spacing.s }]}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>服务器</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s }}>
          <Chip label={`${config.scheme}://${config.ip}:${config.port}`} tone="accent" icon="server" />
          {config.mainnet ? <Chip label={`主网 DIM${config.mainnet.dimid} (${config.mainnet.x}, ${config.mainnet.y}, ${config.mainnet.z})`} tone="neutral" icon="location" /> : null}
        </View>
      </View>
    </View>
  );
}

const statStyles = StyleSheet.create({
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
});

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
  refresh: {
    width: 38,
    height: 38,
    borderRadius: radius.m,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
