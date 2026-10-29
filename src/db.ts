// 本地图标/名称查询缓存 + ae2fc 流体映射 + NBT 解析
import { SQLiteDatabase } from 'expo-sqlite';
var NBT = require('parsenbt-js');

export interface LoadedItem {
  dname: string | null;
  icon: string | null; // base64 png，无图标为 null
}

const itemCache = new Map<string, LoadedItem>();
/**
 * 缓存上限。每条会把图标以 **base64 字符串** 存在 JS 堆里（平均 1.7KB 原始 PNG →
 * 约 2.3KB base64），4000 条就是 ~9MB 常驻。查库是主键索引，很快，
 * 所以宁可让缓存小一点，滚动时多查几次。
 */
const CACHE_MAX = 800;

/**
 * BLOB → base64。
 * 注意：expo-sqlite 有时直接把 BLOB 当 base64 字符串返回（老库是这么用的），
 * 有时返回 Uint8Array（ATTACH 进来的库就是这样），两种都要认。
 */
function toBase64(bytes: Uint8Array | string): string {
  if (typeof bytes === 'string') return bytes;
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  // btoa 把二进制串真正编成 base64；没有的话退回原串（和以前行为一致）
  return typeof btoa === 'function' ? btoa(binary) : binary;
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function readFluidName(nbtobj: any): string | undefined {
  try {
    return nbtobj?.['comp>']?.['str>Fluid'];
  } catch {
    return undefined;
  }
}

/** 源质（神秘时代）在物品列表里的统一 name */
export const ESSENTIA = 'thaumicenergistics:essentia';

/** 服务端塞在流体 NBT 里的颜色（0xRRGGBB），App 用它画纯色流体图标 */
export function readFluidColor(nbtobj: any): number | null {
  try {
    const c = nbtobj?.['comp>'];
    if (!c) return null;
    // 不写死 int>/short>：不同 NBT 解析器的类型前缀可能不一样
    for (const k of Object.keys(c)) {
      if (k.endsWith('>Color')) {
        const v = c[k];
        if (typeof v === 'number') return v & 0xffffff;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 服务端在流体滴 NBT 里额外塞的显示名（没有容器映射时兜底用） */
export function readFluidDisplayName(nbtobj: any): string | undefined {
  try {
    return nbtobj?.['comp>']?.['str>Name'];
  } catch {
    return undefined;
  }
}

// 注意：调用方保证 name 不是 ae2fc:fluid_drop（流体先由 resolveFluid 换成容器物品）
export function lookupItem(db: SQLiteDatabase, name: string, meta: number): LoadedItem {
  const key = `${name}:${meta}`;
  const hit = itemCache.get(key);
  if (hit) return hit;
  const row = db.getFirstSync<{ icon: Uint8Array | null; dname: string | null }>(
    'select icon, dname from item_panel where item_name = $name and item_meta = $meta limit 1',
    { $name: name, $meta: meta },
  );
  let result: LoadedItem = { dname: row?.dname ?? null, icon: null };
  if (row?.icon) result.icon = toBase64(row.icon);
  if (itemCache.size > CACHE_MAX) itemCache.clear();
  itemCache.set(key, result);
  return result;
}

export interface FluidRef {
  fluid: string;
  containerItem: string;
  containerMeta: number;
  dname: string; // 已去掉 单元/胶囊/桶 后缀
}

const fluidCache = new Map<string, FluidRef | null>();
/** 源质：tag → { 中文名, base64 图标, 是否需要现染 }（来自 essentia.db，ATTACH 成 essentia） */
const aspectCache = new Map<string, { dname: string; icon: string | null; tint: boolean } | null>();
/** 流体中文名（fluids.db 的 fluid_name 表），查不到返回 null */
const fluidNameCache = new Map<string, string | null>();
/** 流体图标（fluids.db 的 fluid_icon 表）：tint=1 表示这张图是灰度蒙版，要用颜色现染 */
const fluidIconCache = new Map<string, { icon: string | null; tint: boolean } | null>();

/** 图标库被在线更新替换后必须调用，否则会继续命中旧库的图标/名称 */
export function clearDbCaches(): void {
  itemCache.clear();
  fluidCache.clear();
  aspectCache.clear();
  fluidNameCache.clear();
  fluidIconCache.clear();
}

/** 源质图标/名字：essentia.db 的 aspect 表（tag 统一小写） */
export function lookupAspect(db: SQLiteDatabase, tag: string): { dname: string; icon: string | null; tint: boolean } | null {
  const key = tag.toLowerCase();
  if (aspectCache.has(key)) return aspectCache.get(key)!;
  let row: { dname: string; icon: Uint8Array | null; tint?: number | null } | null = null;
  try {
    row = db.getFirstSync<{ dname: string; icon: Uint8Array | null; tint: number | null }>(
      'select dname, icon, tint from essentia.aspect where tag = $tag limit 1',
      { $tag: key },
    );
  } catch {
    // 老版本图标库没有 tint 列（图标一律是白模）
    try {
      row = db.getFirstSync<{ dname: string; icon: Uint8Array | null }>(
        'select dname, icon from essentia.aspect where tag = $tag limit 1',
        { $tag: key },
      );
    } catch {
      // 辅助库没挂上：源质退回服务端给的英文名 + 问号图标
    }
  }
  const ref = row
    ? {
        dname: row.dname,
        icon: row.icon && row.icon.length ? toBase64(row.icon) : null,
        // tint=0 表示建库时已经把颜色烘进 PNG 了，别再 tint 一遍（会变成双重变暗）
        tint: (row.tint ?? 1) !== 0,
      }
    : null;
  aspectCache.set(key, ref);
  return ref;
}

/** 流体中文名：fluids.db 的 fluid_name 表（GT 汉化的 Material 名） */
export function lookupFluidName(db: SQLiteDatabase, fluid: string): string | null {
  const key = fluid.toLowerCase();
  if (fluidNameCache.has(key)) return fluidNameCache.get(key)!;
  const base = key.replace(/^(molten|plasma|liquid|gas|fluid)\./i, '');
  let row: { dname: string } | null = null;
  try {
    row = db.getFirstSync<{ dname: string }>(
      'select dname from fluids.fluid_name where fluid = $f limit 1',
      { $f: base },
    );
  } catch {
    // 辅助库没挂上：交给上层用服务端给的英文名
  }
  let name = row?.dname ?? null;
  if (name && /^molten\./i.test(key)) name = '熔融' + name;
  else if (name && /^plasma\./i.test(key)) name = '等离子' + name;
  fluidNameCache.set(key, name);
  return name;
}

/**
 * 流体图标：fluids.db 的 fluid_icon 表。
 *
 * 图标是 mods 里 `textures/blocks/fluids/*.png` 抽出来的，按 16×16 缩放成 64px。
 * `tint=1` 表示建库时没拿到颜色（`/aemobile dumpcolors` 没跑过），图是灰度蒙版，
 * 要用服务端 NBT 里的 Color 现染——和源质那套一样。
 */
export function lookupFluidIcon(db: SQLiteDatabase, fluidName: string): { icon: string | null; tint: boolean } | null {
  const key = fluidName.toLowerCase();
  if (fluidIconCache.has(key)) return fluidIconCache.get(key)!;
  let row: { icon: Uint8Array | null; tint: number | null } | null = null;
  try {
    row = db.getFirstSync<{ icon: Uint8Array | null; tint: number | null }>(
      'select icon, tint from fluids.fluid_icon where fluid = $f limit 1',
      { $f: key },
    );
  } catch (e) {
    // 老版本图标库里没有 fluid_icon 表：退回「纯色方块 + 水滴」
    console.warn('[AEMobile][fluid-icon-fail]', key, String(e));
  }
  const ref = row && row.icon && row.icon.length
    ? { icon: toBase64(row.icon), tint: (row.tint ?? 0) !== 0 }
    : null;
  fluidIconCache.set(key, ref);
  return ref;
}

export function lookupFluid(db: SQLiteDatabase, fluidName: string): FluidRef | null {
  if (fluidCache.has(fluidName)) return fluidCache.get(fluidName)!;
  let row: { item: string; meta: number; dname: string } | null = null;
  try {
    row = db.getFirstSync<{ item: string; meta: number; dname: string }>(
      `select container_display_name as dname, item, meta
       from fluids.fluid_container
       where fluid_container.fluid_name = $fluid limit 1`,
      { $fluid: fluidName },
    );
  } catch {
    // 辅助库没挂上：退化成纯颜色 + 水滴图标
  }
  const ref: FluidRef | null = row
    ? {
        fluid: fluidName,
        containerItem: row.item,
        containerMeta: row.meta,
        dname: (row.dname ?? '').replace('单元', '').replace('胶囊', '').replace('桶', ''),
      }
    : null;
  fluidCache.set(fluidName, ref);
  return ref;
}

// 服务端物品 → 本地可寻址形态。流体换成容器物品（保留 original_* 供协议回传）。
export interface ResolvedItem {
  name: string;
  meta: number;
  original_name?: string;
  original_meta?: number;
  nbt?: string | null;
  nbtobj?: any;
  dname: string | null;
  icon: string | null;
  /** 这一行是不是流体（ae2fc 流体滴），UI 用它决定要不要画水滴图标 */
  isFluid?: boolean;
  /** 这一行是不是源质（神秘时代要素），图标直接来自 aspects.ts */
  isEssentia?: boolean;
  /** 流体的颜色（0xRRGGBB），UI 画「纯色方块 + 水滴」用 */
  fluidColor?: number | null;
  /** 蒙版贴图的上色（CSS 色值）：源质白模，或没烘过颜色的流体灰度图 */
  aspectTint?: string | null;
}

export function resolveItem(db: SQLiteDatabase, raw: { name: string; meta: number; nbt?: string | null }): ResolvedItem {
  let name = raw.name;
  let meta = raw.meta;
  let original_name: string | undefined;
  let original_meta: number | undefined;
  let nbtobj: any;
  let dname: string | null = null;
  /** 流体没有容器映射时的兜底显示名（服务端在 NBT 里带的 Name） */
  let fluidDisplayName: string | null = null;
  let isFluid = false;
  let fluidColor: number | null = null;

  // 源质：服务端发 thaumicenergistics:essentia + NBT {Aspect, Name}，
  // 图标/中文名来自 TC4 jar 抽出来的 aspects.ts（50 个要素）
  if (name === ESSENTIA && raw.nbt) {
    try {
      nbtobj = NBT.Reader(base64ToArrayBuffer(raw.nbt));
    } catch {
      nbtobj = undefined;
    }
    const tag = nbtobj?.['comp>']?.['str>Aspect'] as string | undefined;
    // 贴图键统一小写（GT 的源质贴图是大写文件名），数据在 essentia.db
    const info = tag ? lookupAspect(db, tag) : null;
    // 源质贴图是白色蒙版，颜色由服务端给的 Color（Aspect.getColor）决定，UI 用 tintColor 上色；
    // 但图标库如果把颜色烘进 PNG 了（tint=0），就不能再染一遍
    const c = readFluidColor(nbtobj);
    const tint = c != null ? `#${c.toString(16).padStart(6, '0')}` : null;
    if (info) {
      return {
        name,
        meta,
        nbt: raw.nbt,
        nbtobj,
        dname: info.dname,
        icon: info.icon,
        isEssentia: true,
        aspectTint: info.tint ? tint : null,
      };
    }
    const fallback = nbtobj?.['comp>']?.['str>Name'] as string | undefined;
    // 少数附属模组的要素没有贴图（custom1-5 / caelum / tabernus / terminus），
    // 用 TC4 的 _unknown 图标兜底，别显示成「禁止」占位
    const unknownRef = lookupAspect(db, '_unknown');
    return {
      name,
      meta,
      nbt: raw.nbt,
      nbtobj,
      dname: fallback ?? tag ?? '源质',
      icon: unknownRef?.icon ?? null,
      isEssentia: true,
      aspectTint: unknownRef && unknownRef.tint ? tint : null,
    };
  }

  if (name.includes('ae2fc') && raw.nbt) {
    try {
      nbtobj = NBT.Reader(base64ToArrayBuffer(raw.nbt));
    } catch {
      nbtobj = undefined;
    }
    const fluid = nbtobj ? readFluidName(nbtobj) : undefined;
    isFluid = !!fluid;
    const ref = fluid ? lookupFluid(db, fluid) : null;
    if (fluid) {
      // 图标：fluids.db 的 fluid_icon（从 mods 的 fluid 贴图烘出来的），没有就退回「纯色方块 + 水滴」
      fluidColor = readFluidColor(nbtobj);
      const iconRef = lookupFluidIcon(db, fluid);
      original_name = name;
      original_meta = meta;
      if (ref) {
        name = ref.containerItem;
        meta = ref.containerMeta;
        dname = ref.dname;
      } else {
        // 名字优先级：GT 汉化的材料名 > 服务端给的英文名 > 流体 id
        dname = lookupFluidName(db, fluid) ?? readFluidDisplayName(nbtobj) ?? fluid;
      }
      const loadedFluid = lookupItem(db, name, meta);
      return {
        name,
        meta,
        original_name,
        original_meta,
        nbt: raw.nbt,
        nbtobj,
        dname: dname ?? loadedFluid.dname,
        icon: iconRef?.icon ?? null,
        isFluid: true,
        fluidColor,
        // 灰度贴图（没烘过颜色）就用服务端给的颜色现染，和源质一样
        aspectTint: iconRef?.tint && fluidColor != null
          ? `#${fluidColor.toString(16).padStart(6, '0')}`
          : null,
      };
    }
  }
  const loaded = lookupItem(db, name, meta);
  return {
    name,
    meta,
    original_name,
    original_meta,
    nbt: raw.nbt,
    nbtobj,
    dname: dname ?? fluidDisplayName ?? loaded.dname,
    icon: loaded.icon,
    isFluid,
  };
}

// 搜索：本地 db 按显示名模糊匹配，返回 "name:meta" 键集合
export async function searchItemKeys(db: SQLiteDatabase, keyword: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ name: string }>(
    `select concat(item_name, ':', item_meta) as name from item_panel where dname like concat('%', $kw, '%')`,
    { $kw: keyword },
  );
  return new Set(rows.map((r) => r.name));
}
