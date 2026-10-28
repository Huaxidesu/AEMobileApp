// MSPT 曲线（echarts + SVG 渲染）。
//
// ⚠️ 这个文件**只能被懒加载**，不要从 MonitorScreen 顶层 import：
// echarts 的 JS 体积很大，一旦进入启动路径就会常驻内存（实测多占 ~60MB）。
// 现在 MSPT 功能已从 mod 移除、由独立插件提供，绝大多数用户不会用到曲线，
// 所以只有真的收到 tick 数据时才把这一坨加载进来。
import React, { useEffect, useRef } from 'react';
import { Dimensions } from 'react-native';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent } from 'echarts/components';
import { SVGRenderer, SvgChart } from '@wuba/react-native-echarts';
import { themedStyles, useTheme, spacing } from '../theme';

echarts.use([SVGRenderer, LineChart, GridComponent]);

export interface MsptPoint {
  label: string;
  m5: number;
  m30: number;
  m300: number;
}

export default function MonitorChart({ points }: { points: MsptPoint[] }) {
  const { colors } = useTheme();
  const surfaceRef = useRef<any>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  const chartW = Math.min(Dimensions.get('window').width - spacing.l * 4, 340);
  const chartH = 200;

  useEffect(() => {
    if (!surfaceRef.current) return;
    const chart = echarts.init(surfaceRef.current, colors.isDark ? 'dark' : undefined, {
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
  }, [colors, chartW, chartH]);

  useEffect(() => {
    chartRef.current?.setOption({
      xAxis: { data: points.map((p) => p.label) },
      series: [
        { data: points.map((p) => p.m5) },
        { data: points.map((p) => p.m30) },
        { data: points.map((p) => p.m300) },
      ],
    });
  }, [points]);

  return <SvgChart ref={surfaceRef} style={{ alignSelf: 'center' }} />;
}
