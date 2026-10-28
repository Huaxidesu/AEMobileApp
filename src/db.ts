// 本地图标/名称查询缓存 + ae2fc 流体映射 + NBT 解析
import { SQLiteDatabase } from 'expo-sqlite';
var NBT = require('parsenbt-js');
import { ASPECTS } from './aspects';
import { fluidName } from './fluidNames';

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

function toBase64(bytes: Uint8Array): string {
  // 分段转换，避免 Function.apply 参数过长
  let out = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return out;
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

/** 图标库被在线更新替换后必须调用，否则会继续命中旧库的图标/名称 */
export function clearDbCaches(): void {
  itemCache.clear();
  fluidCache.clear();
}

export function lookupFluid(db: SQLiteDatabase, fluidName: string): FluidRef | null {
  if (fluidCache.has(fluidName)) return fluidCache.get(fluidName)!;
  const row = db.getFirstSync<{ item: string; meta: number; dname: string }>(
    `select container_display_name as dname, item, meta
     from fluid_container, item_panel
     where item_panel.item_name = fluid_container.item
       and fluid_container.meta = item_panel.item_meta
       and fluid_container.fluid_name = $fluid limit 1`,
    { $fluid: fluidName },
  );
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
  /** 源质的颜色（CSS 色值），UI 用它给白色蒙版贴图上色 */
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
    // 贴图键统一小写（GT 的源质贴图是大写文件名）
    const info = tag ? ASPECTS[tag.toLowerCase()] : undefined;
    // 源质贴图是白色蒙版，颜色由服务端给的 Color（Aspect.getColor）决定，UI 用 tintColor 上色
    const c = readFluidColor(nbtobj);
    const tint = c != null ? `#${c.toString(16).padStart(6, '0')}` : null;
    if (info) {
      return {
        name,
        meta,
        nbt: raw.nbt,
        nbtobj,
        dname: info.n,
        icon: info.i,
        isEssentia: true,
        aspectTint: tint,
      };
    }
    const fallback = nbtobj?.['comp>']?.['str>Name'] as string | undefined;
    // 少数附属模组的要素没有贴图（custom1-5 / caelum / tabernus / terminus），
    // 用 TC4 的 _unknown 图标兜底，别显示成「禁止」占位
    const unknown = ASPECTS['_unknown']?.i ?? null;
    return {
      name,
      meta,
      nbt: raw.nbt,
      nbtobj,
      dname: fallback ?? tag ?? '源质',
      icon: unknown,
      isEssentia: true,
      aspectTint: tint,
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
      // 流体一律用「纯色方块 + 水滴」当图标（和游戏里 AE 终端一致），不再借容器的图标
      fluidColor = readFluidColor(nbtobj);
      original_name = name;
      original_meta = meta;
      if (ref) {
        name = ref.containerItem;
        meta = ref.containerMeta;
        dname = ref.dname;
      } else {
        // 名字优先级：GT 汉化的材料名 > 服务端给的英文名 > 流体 id
        dname = fluidName(fluid) ?? readFluidDisplayName(nbtobj) ?? fluid;
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
        icon: null,
        isFluid: true,
        fluidColor,
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
