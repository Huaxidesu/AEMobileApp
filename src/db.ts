// 本地图标/名称查询缓存 + ae2fc 流体映射 + NBT 解析
import { SQLiteDatabase } from 'expo-sqlite';
var NBT = require('parsenbt-js');

export interface LoadedItem {
  dname: string | null;
  icon: string | null; // base64 png，无图标为 null
}

const itemCache = new Map<string, LoadedItem>();
const CACHE_MAX = 4000;

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
}

export function resolveItem(db: SQLiteDatabase, raw: { name: string; meta: number; nbt?: string | null }): ResolvedItem {
  let name = raw.name;
  let meta = raw.meta;
  let original_name: string | undefined;
  let original_meta: number | undefined;
  let nbtobj: any;
  let dname: string | null = null;

  if (name.includes('ae2fc') && raw.nbt) {
    try {
      nbtobj = NBT.Reader(base64ToArrayBuffer(raw.nbt));
    } catch {
      nbtobj = undefined;
    }
    const fluid = nbtobj ? readFluidName(nbtobj) : undefined;
    const ref = fluid ? lookupFluid(db, fluid) : null;
    if (ref) {
      original_name = name;
      original_meta = meta;
      name = ref.containerItem;
      meta = ref.containerMeta;
      dname = ref.dname;
    }
  }
  const loaded = lookupItem(db, name, meta);
  return { name, meta, original_name, original_meta, nbt: raw.nbt, nbtobj, dname: dname ?? loaded.dname, icon: loaded.icon };
}

// 搜索：本地 db 按显示名模糊匹配，返回 "name:meta" 键集合
export async function searchItemKeys(db: SQLiteDatabase, keyword: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ name: string }>(
    `select concat(item_name, ':', item_meta) as name from item_panel where dname like concat('%', $kw, '%')`,
    { $kw: keyword },
  );
  return new Set(rows.map((r) => r.name));
}
