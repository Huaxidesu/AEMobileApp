// 物品网格的显示偏好：每行几列、每页几行（= 分页大小）、浏览方式（无限下滑 / 翻页）。
// 和主题一样存在 SecureStore 里，改完立刻生效（物品页订阅这个 context）。
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

/** scroll = 无限下滑（默认）；page = 分页，底部翻页条可跳页 */
export type GridMode = 'scroll' | 'page';

export interface GridPrefs {
  /** 每行几列 */
  columns: number;
  /** 每页几行（翻页模式的页大小 = columns × rows） */
  rows: number;
  /** 浏览方式 */
  mode: GridMode;
}

export const GRID_LIMITS = {
  columns: { min: 2, max: 8 },
  rows: { min: 2, max: 12 },
};

export const DEFAULT_GRID: GridPrefs = { columns: 4, rows: 6, mode: 'scroll' };

const KEY = 'ui.grid';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function loadPrefs(): GridPrefs {
  try {
    const raw = SecureStore.getItem(KEY);
    const p = raw ? JSON.parse(raw) : null;
    const columns = Number(p?.columns);
    const rows = Number(p?.rows);
    return {
      columns: Number.isFinite(columns) ? clamp(columns, GRID_LIMITS.columns.min, GRID_LIMITS.columns.max) : DEFAULT_GRID.columns,
      rows: Number.isFinite(rows) ? clamp(rows, GRID_LIMITS.rows.min, GRID_LIMITS.rows.max) : DEFAULT_GRID.rows,
      // 老版本的记录没有 mode，按新的默认值（无限下滑）处理
      mode: p?.mode === 'page' ? 'page' : 'scroll',
    };
  } catch {
    return DEFAULT_GRID;
  }
}

interface GridCtx {
  prefs: GridPrefs;
  /** 每页能放几个物品（仅翻页模式使用） */
  pageSize: number;
  setColumns: (n: number) => void;
  setRows: (n: number) => void;
  setMode: (m: GridMode) => void;
  reset: () => void;
}

const Ctx = createContext<GridCtx | null>(null);

export function GridProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<GridPrefs>(loadPrefs);

  const update = useCallback((next: GridPrefs) => {
    const clean: GridPrefs = {
      columns: clamp(next.columns, GRID_LIMITS.columns.min, GRID_LIMITS.columns.max),
      rows: clamp(next.rows, GRID_LIMITS.rows.min, GRID_LIMITS.rows.max),
      mode: next.mode === 'page' ? 'page' : 'scroll',
    };
    setPrefs(clean);
    try {
      SecureStore.setItem(KEY, JSON.stringify(clean));
    } catch {
      // 存不下就只在本次运行里生效
    }
  }, []);

  const value = useMemo<GridCtx>(
    () => ({
      prefs,
      pageSize: prefs.columns * prefs.rows,
      setColumns: (n) => update({ ...prefs, columns: n }),
      setRows: (n) => update({ ...prefs, rows: n }),
      setMode: (m) => update({ ...prefs, mode: m }),
      reset: () => update(DEFAULT_GRID),
    }),
    [prefs, update],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGrid(): GridCtx {
  const ctx = useContext(Ctx);
  return (
    ctx ?? {
      prefs: DEFAULT_GRID,
      pageSize: DEFAULT_GRID.columns * DEFAULT_GRID.rows,
      setColumns: () => {},
      setRows: () => {},
      setMode: () => {},
      reset: () => {},
    }
  );
}
