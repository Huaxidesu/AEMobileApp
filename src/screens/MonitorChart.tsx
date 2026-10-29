// TPS / MSPT 曲线（echarts + SVG 渲染）。
//
// ⚠️ 这个文件**只能被懒加载**，不要从 MonitorScreen 顶层 import：
// echarts 的 JS 体积很大，一旦进入启动路径就会常驻内存（实测多占 ~60MB）。
//
// 两条线：实线是窗口均值，虚线是窗口内的**单 tick 峰值** —— 5 秒粒度下峰值也不会丢，
// 这比 1 秒采样更能看出「刚才卡了一下」。数据里的 null 表示断档（App 关过 / 页面切走过），
// 断档不连线，避免画出一条假的平滑曲线。
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent } from 'echarts/components';
import { SVGRenderer, SvgChart } from '@wuba/react-native-echarts';
import { useTheme } from '../theme';

echarts.use([SVGRenderer, LineChart, GridComponent, MarkLineComponent]);

/** v = 窗口均值，max = 窗口内峰值，t = 毫秒时间戳 */
export interface ChartPoint {
  t: number;
  v: number;
  max: number;
}

interface Props {
  points: (ChartPoint | null)[];
  unit: 'mspt' | 'tps';
  /** 参考线（MSPT 模式画 50ms 红线；TPS 模式不画） */
  threshold?: number;
  width: number;
  height?: number;
}

function label(t: number, spanMs: number): string {
  const d = new Date(t);
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  if (spanMs > 10 * 60 * 1000) return `${String(d.getHours()).padStart(2, '0')}:${mm}`;
  return `${mm}:${ss}`;
}

export default function MonitorChart({ points, unit, threshold, width, height = 170 }: Props) {
  const { colors } = useTheme();
  const surfaceRef = useRef<any>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  /**
   * Y 轴上限按 P90 自适应。
   * 服务器启动/区块加载时单 tick 能到 1700ms，直接自动缩放会把正常范围压成一条直线，
   * 50ms 的参考线也会贴到最底下。截到 P90 之后，尖峰只是冲出画面顶部（一眼就能看出「刚才炸了一下」），
   * 平常的波动看得清。
   */
  const yMax = (() => {
    if (unit === 'tps') return 20;
    const vals: number[] = [];
    for (const p of points) {
      if (!p) continue;
      vals.push(p.v);
      vals.push(p.max);
    }
    if (!vals.length) return 100;
    vals.sort((a, b) => a - b);
    const p90 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))];
    return Math.min(2000, Math.max(60, Math.ceil(p90 * 1.3)));
  })();

  useEffect(() => {
    if (!surfaceRef.current) return;
    const chart = echarts.init(surfaceRef.current, colors.isDark ? 'dark' : undefined, {
      renderer: 'svg',
      width,
      height,
    });
    chart.setOption({
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 34, right: 10, top: 10, bottom: 18 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        axisLine: { lineStyle: { color: colors.border } },
        axisTick: { show: false },
        axisLabel: { color: colors.textFaint, fontSize: 9, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: unit === 'tps' ? 20 : undefined,
        splitNumber: 3,
        axisLabel: { color: colors.textFaint, fontSize: 9 },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        {
          name: '均值',
          type: 'line',
          showSymbol: false,
          smooth: false,
          connectNulls: false,
          data: [],
          lineStyle: { color: colors.accent, width: 2 },
          areaStyle: { color: colors.accent, opacity: 0.14 },
          markLine:
            unit === 'mspt' && threshold
              ? {
                  silent: true,
                  symbol: 'none',
                  label: { show: false },
                  lineStyle: { color: colors.bad, type: 'dashed', width: 1, opacity: 0.7 },
                  data: [{ yAxis: threshold }],
                }
              : undefined,
        },
        {
          name: '峰值',
          type: 'line',
          showSymbol: false,
          smooth: false,
          connectNulls: false,
          data: [],
          lineStyle: { color: colors.warn, width: 1, type: 'dashed', opacity: 0.9 },
        },
      ],
    });
    chartRef.current = chart;
    return () => {
      chart.dispose();
      chartRef.current = null;
    };
  }, [colors, width, height, unit, threshold]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const span = points.length > 1 && points[0] && points[points.length - 1]
      ? points[points.length - 1]!.t - points[0]!.t
      : 0;
    const labels = points.map((p) => (p ? label(p.t, span) : ''));
    // 标签太密就隔几个显示一个
    const step = Math.max(1, Math.ceil(points.length / 5));
    chart.setOption({
      xAxis: {
        data: labels,
        axisLabel: { interval: step - 1 },
      },
      // 只更新 max，不重建实例（重建 echarts 比设一次 option 贵得多）
      yAxis: { max: yMax },
      series: [
        { data: points.map((p) => (p ? Number(p.v.toFixed(2)) : null)) },
        { data: points.map((p) => (p ? Number(p.max.toFixed(2)) : null)) },
      ],
    });
  }, [points, yMax]);

  return <SvgChart ref={surfaceRef} style={{ alignSelf: 'center', width, height }} />;
}
