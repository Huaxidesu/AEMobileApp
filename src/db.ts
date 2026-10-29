// 本地图标/名称查询缓存 + ae2fc 流体映射 + NBT 解析
//
// ── 2026-10-29 性能重构：图标改成「按需加载」──
//
// 以前 resolveItem() 会把每条物品的图标一起读出来（平均 2.4KB PNG → 3.3KB base64），
// 物品页一次 resolve 一万七千条 = 五十多 MB 常驻 JS 堆，而且每条一次同步查询。
// 现在：
//   1. dname 走 prefetchNames() 批量取（几十条 SQL，而不是一万七千次单查）；
//   2. icon 是**惰性 getter**，只有真正渲染到的格子才会查库，并进按字节计的 LRU；
//   3. 名字缓存与图标缓存分开，名字是纯字符串（几十 KB），可以放得很大。
//
// 调用方注意：`icon` / `aspectTint` 是 getter，展开对象（`{...item}`）会触发查询。
// 列表页请把解析结果整体持有（见 ItemsScreen 的 Row），不要逐字段拷贝。
import { SQLiteDatabase } from 'expo-sqlite';
var NBT = require('parsenbt-js');

/** 名字缓存条数上限：每条只有一个字符串，9 万条约 3MB，够覆盖多个服务器的物品表 */
const NAME_CACHE_MAX = 90000;
/** 图标缓存字节上限（JS 字符串按 UTF-16 计，1 字符 = 2 字节） */
const ICON_CACHE_BYTES = 12 * 1024 * 1024;

/**
 * 按字节计容的 LRU。
 *
 * 以前 itemCache 是「超过 800 条就 clear()」，一万七千条一次解析会清空二十多次，
 * 等于缓存从来没生效过；这里改成真正的 LRU：超上限就从最久未用的开始淘汰。
 */
class ByteLru {
  private map = new Map<string, string>();
  private bytes = 0;

  constructor(private limit: number) {}

  /** 命中返回值；没查过返回 undefined（空串表示「查过，但没有图标」） */
  get(key: string): string | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // Map 保持插入顺序：删了再塞回去 = 移到队尾（最近使用）
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: string): void {
    const old = this.map.get(key);
    if (old !== undefined) {
      this.bytes -= old.length * 2;
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.bytes += value.length * 2;
    while (this.bytes > this.limit) {
      const first = this.map.keys().next();
      if (first.done) break;
      const victim = this.map.get(first.value);
      this.map.delete(first.value);
      if (victim) this.bytes -= victim.length * 2;
    }
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  get size(): number {
    return this.map.size;
  }
}

export interface FluidRef {
  fluid: string;
  containerItem: string;
  containerMeta: number;
  dname: string; // 已去掉 单元/胶囊/桶 后缀
}

/** 物品显示名：key = `name:meta` */
const nameCache = new Map<string, string | null>();
/** 物品图标（base64 PNG）：key = `name:meta`；空串表示查过但没有 */
const itemIconLru = new ByteLru(ICON_CACHE_BYTES);
/** 流体图标：key = 流体名（小写） */
const fluidIconLru = new ByteLru(ICON_CACHE_BYTES / 4);
/** 流体 → 容器物品映射 */
const fluidCache = new Map<string, FluidRef | null>();
/** 源质：tag → { 中文名, base64 图标, 是否需要现染 }。只有几十个，整条缓存不心疼 */
const aspectCache = new Map<string, { dname: string; icon: string | null; tint: boolean } | null>();
/** 流体中文名（fluids.db 的 fluid_name 表），查不到返回 null */
const fluidNameCache = new Map<string, string | null>();

/** 图标库被在线更新替换后必须调用，否则会继续命中旧库的图标/名称 */
export function clearDbCaches(): void {
  nameCache.clear();
  itemIconLru.clear();
  fluidIconLru.clear();
  fluidCache.clear();
  aspectCache.clear();
  fluidNameCache.clear();
}

/** 缓存现状（排查用） */
export function dbCacheStats() {
  return { names: nameCache.size, itemIcons: itemIconLru.size, fluidIcons: fluidIconLru.size };
}

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
/**
 * GTNH 的 Aspect Recipe Index 把要素做成了**真物品**（NBT 里 `{Aspect:"aer"}`），
 * NEI 里看到的「Aer / aspectrecipeindex:aspect」就是它。图标和中文名同样来自 essentia.db。
 */
export const ASPECT_ITEM = 'aspectrecipeindex:aspect';

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

function hexColor(v: number): string {
  return `#${(v & 0xffffff).toString(16).padStart(6, '0')}`;
}

// --------------------------------------------------------------- 名字

/**
 * 批量预取显示名。
 *
 * 只有「搜索」和「按名称排序」才需要：一万七千条物品的显示名一条都不画在网格上，
 * 所以默认视图完全不碰这个函数（见 resolveItem 里惰性的 dname）。
 *
 * 用 `(item_name, item_meta) IN (VALUES ...)` 精确取，比按名字 IN 少返回三倍的行
 * （GT 一个名字往往有十几个 meta）；老 SQLite 不支持行值时退回按名字查。
 */
export function prefetchNames(db: SQLiteDatabase, raws: { item_name: string; meta: number }[]): number {
  const missing = new Map<string, [string, number]>();
  for (const r of raws) {
    const k = `${r.item_name}:${r.meta}`;
    if (!nameCache.has(k)) missing.set(k, [r.item_name, r.meta]);
  }
  if (missing.size === 0) return 0;

  const pairs = Array.from(missing.values());
  // 400 对 = 800 个参数，卡在 SQLite 默认 999 上限之内
  const CHUNK = 400;
  let filled = 0;
  let ok = false;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    const params: any[] = [];
    for (const [n, m] of chunk) params.push(n, m);
    const placeholders = chunk.map(() => '(?,?)').join(',');
    // 一次查询把整块结果拼成一个字符串带回来。
    // 为什么不用「返回多行」：实测 45 次 getAllSync（每次 150 行 × 3 列）在模拟器上要 750ms，
    // 而 SQLite 本身只要 38ms —— 时间全花在 JSI 逐行转 JS 对象上。
    // group_concat 把 6609 行压成 220KB 的单个字符串，一次传输完事。
    // distinct 是因为图标库里存在重复的 (item_name, item_meta)（gendustry:GeneSample 有 1067 行）。
    try {
      const row = db.getFirstSync<{ s: string | null }>(
        `select group_concat(k, char(2)) as s from (
           select distinct item_name || char(1) || item_meta || char(1) || coalesce(dname, '') as k
           from item_panel where (item_name, item_meta) in (values ${placeholders}))`,
        params,
      );
      const s = row?.s;
      if (s) {
        for (const seg of s.split('\u0002')) {
          const a = seg.indexOf('\u0001');
          if (a < 0) continue;
          const b = seg.indexOf('\u0001', a + 1);
          if (b < 0) continue;
          const name = seg.slice(0, a);
          const meta = Number(seg.slice(a + 1, b));
          const dname = seg.slice(b + 1);
          nameCache.set(`${name}:${meta}`, dname || null);
          filled++;
        }
      }
      ok = true;
    } catch {
      // 老 SQLite 不支持行值语法：退回「按名字查多行」
      try {
        const names = chunk.map((p) => p[0]);
        const rows = db.getAllSync<{ item_name: string; item_meta: number; dname: string | null }>(
          `select item_name, item_meta, dname from item_panel where item_name in (${names.map(() => '?').join(',')})`,
          names,
        );
        for (const row of rows) {
          nameCache.set(`${row.item_name}:${row.item_meta}`, row.dname);
          filled++;
        }
        ok = true;
      } catch {
        // 库没打开/表不存在：交给单条查询兜底
      }
    }
  }
  if (ok) {
    for (const r of raws) {
      const k = `${r.item_name}:${r.meta}`;
      if (!nameCache.has(k)) nameCache.set(k, null);
    }
  }
  if (nameCache.size > NAME_CACHE_MAX) {
    // 淘汰最旧的两成，而不是整表清空：清空会让下一次搜索/排序重新花几百毫秒预取
    const drop = Math.floor(NAME_CACHE_MAX * 0.2);
    let i = 0;
    for (const k of nameCache.keys()) {
      if (i++ >= drop) break;
      nameCache.delete(k);
    }
  }
  return filled;
}

/** 单个物品的显示名（批量预取没覆盖到的走这里） */
export function lookupDname(db: SQLiteDatabase, name: string, meta: number): string | null {
  const key = `${name}:${meta}`;
  if (nameCache.has(key)) return nameCache.get(key)!;
  let dname: string | null = null;
  try {
    const row = db.getFirstSync<{ dname: string | null }>(
      'select dname from item_panel where item_name = $name and item_meta = $meta limit 1',
      { $name: name, $meta: meta },
    );
    dname = row?.dname ?? null;
  } catch {
    // 表不存在（图标库还没装好）：当作没有
  }
  if (nameCache.size > NAME_CACHE_MAX) nameCache.delete(nameCache.keys().next().value as string);
  nameCache.set(key, dname);
  return dname;
}

// --------------------------------------------------------------- 图标

/** 物品图标（按需查 + LRU）。空串是「查过但没有」的哨兵，转成 null 返回 */
export function lookupItemIcon(db: SQLiteDatabase, name: string, meta: number): string | null {
  const key = `${name}:${meta}`;
  const hit = itemIconLru.get(key);
  if (hit !== undefined) return hit === '' ? null : hit;
  let icon: string | null = null;
  try {
    const row = db.getFirstSync<{ icon: Uint8Array | string | null }>(
      'select icon from item_panel where item_name = $name and item_meta = $meta limit 1',
      { $name: name, $meta: meta },
    );
    if (row?.icon) icon = toBase64(row.icon);
  } catch {
    // 同上：查不到就当没图标，别让列表崩掉
  }
  itemIconLru.set(key, icon ?? '');
  return icon;
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
  const cached = fluidIconLru.get(key);
  if (cached !== undefined) {
    if (cached === '') return null;
    // 用一个字符前缀带 tint 标记，省掉第二个缓存表
    return cached[0] === '1' ? { icon: cached.slice(1), tint: true } : { icon: cached.slice(1), tint: false };
  }
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
  if (!row || !row.icon || !row.icon.length) {
    fluidIconLru.set(key, '');
    return null;
  }
  const tint = (row.tint ?? 0) !== 0;
  const icon = toBase64(row.icon);
  fluidIconLru.set(key, (tint ? '1' : '0') + icon);
  return { icon, tint };
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
//
// 为什么是 class 而不是「普通对象 + Object.defineProperty」：
// defineProperty 把数据属性改成访问器时，Hermes 会把对象切成字典模式，之后所有属性
// 访问都变慢，调用本身也不便宜 —— 实测 6609 条要 201ms。改成原型上的 getter 后
// 隐藏类保持稳定，构造只做字段赋值。
export class ResolvedItem {
  readonly name: string;
  readonly meta: number;
  readonly original_name?: string;
  readonly original_meta?: number;
  readonly nbt?: string | null;
  readonly nbtobj?: any;
  /** 这一行是不是流体（ae2fc 流体滴），UI 用它决定要不要画水滴图标 */
  readonly isFluid: boolean;
  /** 这一行是不是源质（神秘时代要素），图标直接来自 essentia.db */
  readonly isEssentia: boolean;
  /** 流体的颜色（0xRRGGBB），UI 画「纯色方块 + 水滴」用 */
  readonly fluidColor: number | null;

  private readonly db: SQLiteDatabase;
  /** 0 = 图标已就绪（源质），1 = 物品图标，2 = 流体图标 */
  private readonly iconKind: 0 | 1 | 2;
  /** 物品名 或 流体名 */
  private readonly iconKey: string;
  private readonly tintColor: number | null;

  private dn: string | null = null;
  private dnDone = false;
  private ic: string | null = null;
  private tint: string | null = null;
  private icDone = false;

  constructor(db: SQLiteDatabase, init: ResolvedInit) {
    this.db = db;
    this.name = init.name;
    this.meta = init.meta;
    this.original_name = init.original_name;
    this.original_meta = init.original_meta;
    this.nbt = init.nbt ?? null;
    this.nbtobj = init.nbtobj;
    this.isFluid = !!init.isFluid;
    this.isEssentia = !!init.isEssentia;
    this.fluidColor = init.fluidColor ?? null;
    this.iconKind = init.iconKind ?? 0;
    this.iconKey = init.iconKey ?? '';
    this.tintColor = init.tintColor ?? null;
    // 已经确定的值直接标记为「取过」，不再查库
    if (init.dname !== undefined) {
      this.dn = init.dname;
      this.dnDone = true;
    }
    if (init.icon !== undefined) {
      this.ic = init.icon;
      this.tint = init.tint ?? null;
      this.icDone = true;
    }
  }

  /** 显示名。普通物品第一次读才查库（网格只画图标和数量，一万七千条一条都不需要） */
  get dname(): string | null {
    if (!this.dnDone) {
      this.dn = lookupDname(this.db, this.name, this.meta);
      this.dnDone = true;
    }
    return this.dn;
  }

  /** 图标 base64。第一次读才查库，并进按字节计的 LRU */
  get icon(): string | null {
    if (!this.icDone) this.loadIcon();
    return this.ic;
  }

  /** 蒙版贴图的上色（源质白模 / 没烘过颜色的流体灰度图） */
  get aspectTint(): string | null {
    if (!this.icDone) this.loadIcon();
    return this.tint;
  }

  private loadIcon(): void {
    this.icDone = true;
    if (this.iconKind === 1) {
      this.ic = lookupItemIcon(this.db, this.iconKey, this.meta);
      this.tint = null;
    } else if (this.iconKind === 2) {
      const ref = lookupFluidIcon(this.db, this.iconKey);
      this.ic = ref?.icon ?? null;
      // 灰度贴图（没烘过颜色）就用服务端给的颜色现染，和源质一样
      this.tint = ref?.tint && this.tintColor != null ? hexColor(this.tintColor) : null;
    }
  }
}

interface ResolvedInit {
  name: string;
  meta: number;
  original_name?: string;
  original_meta?: number;
  nbt?: string | null;
  nbtobj?: any;
  isFluid?: boolean;
  isEssentia?: boolean;
  fluidColor?: number | null;
  /** 已确定的显示名（源质/流体），不给就是惰性 */
  dname?: string | null;
  /** 已确定的图标（源质），不给就是惰性 */
  icon?: string | null;
  tint?: string | null;
  iconKind?: 0 | 1 | 2;
  iconKey?: string;
  tintColor?: number | null;
}

export function resolveItem(db: SQLiteDatabase, raw: { name: string; meta: number; nbt?: string | null }): ResolvedItem {
  let name = raw.name;
  let meta = raw.meta;
  let nbtobj: any;

  // 源质：服务端发 thaumicenergistics:essentia + NBT {Aspect, Name}，
  // 图标/中文名来自 essentia.db（TC4 jar 抽出来的要素贴图）
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
    const tint = c != null ? hexColor(c) : null;
    if (info) {
      return new ResolvedItem(db, {
        name,
        meta,
        nbt: raw.nbt,
        nbtobj,
        dname: info.dname,
        icon: info.icon,
        isEssentia: true,
        tint: info.tint ? tint : null,
      });
    }
    const fallback = nbtobj?.['comp>']?.['str>Name'] as string | undefined;
    // 少数附属模组的要素没有贴图（custom1-5 / caelum / tabernus / terminus），
    // 用 TC4 的 _unknown 图标兜底，别显示成「禁止」占位
    const unknownRef = lookupAspect(db, '_unknown');
    return new ResolvedItem(db, {
      name,
      meta,
      nbt: raw.nbt,
      nbtobj,
      dname: fallback ?? tag ?? '源质',
      icon: unknownRef?.icon ?? null,
      isEssentia: true,
      tint: unknownRef && unknownRef.tint ? tint : null,
    });
  }

  // ARI 的要素物品：name 固定、靠 NBT 里的 Aspect 区分。
  // 注意这里**不改 name/meta**——下单时要原样发回去（服务端按 ItemStack + NBT 建栈），
  // 和流体滴「换成容器物品显示」的套路相反。
  if (name === ASPECT_ITEM && raw.nbt) {
    try {
      nbtobj = NBT.Reader(base64ToArrayBuffer(raw.nbt));
    } catch {
      nbtobj = undefined;
    }
    const tag = nbtobj?.['comp>']?.['str>Aspect'] as string | undefined;
    const info = tag ? lookupAspect(db, tag) : null;
    if (info) {
      const c = readFluidColor(nbtobj);
      return new ResolvedItem(db, {
        name,
        meta,
        nbt: raw.nbt,
        nbtobj,
        dname: info.dname,
        icon: info.icon,
        isEssentia: true,
        tint: info.tint && c != null ? hexColor(c) : null,
      });
    }
  }

  if (name.includes('ae2fc') && raw.nbt) {
    try {
      nbtobj = NBT.Reader(base64ToArrayBuffer(raw.nbt));
    } catch {
      nbtobj = undefined;
    }
    const fluid = nbtobj ? readFluidName(nbtobj) : undefined;
    if (fluid) {
      const ref = lookupFluid(db, fluid);
      const fluidColor = readFluidColor(nbtobj);
      const original_name = name;
      const original_meta = meta;
      let dname: string;
      if (ref) {
        name = ref.containerItem;
        meta = ref.containerMeta;
        dname = ref.dname;
      } else {
        // 名字优先级：GT 汉化的材料名 > 服务端给的英文名 > 流体 id
        dname = lookupFluidName(db, fluid) ?? readFluidDisplayName(nbtobj) ?? fluid;
      }
      // 图标：fluids.db 的 fluid_icon（从 mods 的 fluid 贴图烘出来的），
      // 没有就退回「纯色方块 + 水滴」（ItemIcon 的 fluid 分支）
      return new ResolvedItem(db, {
        name,
        meta,
        original_name,
        original_meta,
        nbt: raw.nbt,
        nbtobj,
        dname,
        isFluid: true,
        fluidColor,
        iconKind: 2,
        iconKey: fluid,
        tintColor: fluidColor,
      });
    }
  }

  return new ResolvedItem(db, {
    name,
    meta,
    nbt: raw.nbt,
    nbtobj,
    iconKind: 1,
    iconKey: name,
  });
}

// 搜索：本地 db 按显示名模糊匹配，返回 "name:meta" 键集合
export async function searchItemKeys(db: SQLiteDatabase, keyword: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ name: string }>(
    `select concat(item_name, ':', item_meta) as name from item_panel where dname like concat('%', $kw, '%')`,
    { $kw: keyword },
  );
  return new Set(rows.map((r) => r.name));
}
