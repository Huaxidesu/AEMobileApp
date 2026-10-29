// 监控页的显示偏好。和 gridprefs / theme 一样存在 SecureStore 里，改完立刻生效。
//
// 注意：**刷新频率不在这里** —— TPS 固定 5 秒一推（服务端硬编码），
// 用户可调只会让人以为更实时，实际是白耗电。这里只放「看什么、怎么排」。
import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

/** all = 全部世界；personal = 只看家园（PERSONAL_DIM_*）；occupied = 只看有人的 */
export type WorldFilter = 'all' | 'personal' | 'occupied';
/** desc = MSPT 从高到低（找瓶颈）；asc = 从低到高 */
export type WorldSort = 'desc' | 'asc';
/** 曲线时间范围 */
export type ChartRange = '5m' | '15m';

export interface MonitorPrefs {
  filter: WorldFilter;
  sort: WorldSort;
  range: ChartRange;
  /** 点开过「检测」的维度（主世界由 config 决定，不在这里） */
  tracked: number[];
  /** 当前展开曲线的那一个维度 */
  expanded: number | null;
}

const KEY = 'ui.monitor';

export const DEFAULT_MONITOR: MonitorPrefs = {
  filter: 'all',
  sort: 'desc',
  range: '5m',
  tracked: [],
  expanded: null,
};

function clean(raw: any): MonitorPrefs {
  const tracked = Array.isArray(raw?.tracked)
    ? raw.tracked.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n))
    : [];
  return {
    filter: raw?.filter === 'personal' || raw?.filter === 'occupied' ? raw.filter : 'all',
    sort: raw?.sort === 'asc' ? 'asc' : 'desc',
    range: raw?.range === '15m' ? '15m' : '5m',
    // 去重 + 上限 32：服务端一次最多推 32 个维度，超过没有意义
    tracked: Array.from(new Set<number>(tracked)).slice(0, 32),
    expanded: Number.isInteger(raw?.expanded) ? Number(raw.expanded) : null,
  };
}

function load(): MonitorPrefs {
  try {
    const raw = SecureStore.getItem(KEY);
    return raw ? clean(JSON.parse(raw)) : DEFAULT_MONITOR;
  } catch {
    return DEFAULT_MONITOR;
  }
}

/** 只有监控页用，所以不建 Provider，一个 hook 就够 */
export function useMonitorPrefs(): [MonitorPrefs, (patch: Partial<MonitorPrefs>) => void] {
  const [prefs, setPrefs] = useState<MonitorPrefs>(load);

  // 启动时同步读一次：第一帧就是用户上次的设置，不会闪一下默认值
  useEffect(() => {
    setPrefs(load());
  }, []);

  const update = useCallback((patch: Partial<MonitorPrefs>) => {
    setPrefs((prev) => {
      const next = clean({ ...prev, ...patch });
      try {
        SecureStore.setItem(KEY, JSON.stringify(next));
      } catch {
        // 存不下就只在本次运行里生效
      }
      return next;
    });
  }, []);

  return [prefs, update];
}
