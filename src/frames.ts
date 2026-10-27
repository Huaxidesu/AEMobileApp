// SSE 增量帧的客户端状态机。
//
// 服务端每帧只发变化的部分（见 AEMobile/doc/传输协议与安全.md §3），
// 这里负责把「全量 + 增量 + 心跳」还原成完整列表。
//
// 设计要点：
// - 物品 / 任务用 `name|meta` 做键（AE2 返回顺序不保证稳定，不能按下标对齐）；
// - CPU 用 idx 做键（AE2 的 CPU 列表顺序稳定）；
// - 收到 `t:'f'` 就整体重建，收到 `t:'d'` 就地打补丁，`t:'k'` 什么都不做。
import { CraftTaskItem, CraftingCPUInfo, ItemStackResp, SseFrame, itemKey } from './api';

export type FrameKind = 'full' | 'delta' | 'heartbeat' | 'error';

function kindOf(frame: SseFrame): FrameKind {
  switch (frame.t) {
    case 'f':
      return 'full';
    case 'd':
      return 'delta';
    case 'k':
      return 'heartbeat';
    default:
      return 'error';
  }
}

export class ItemAccumulator {
  private map = new Map<string, ItemStackResp>();
  sid = '';
  seq = 0;

  reset(): void {
    this.map.clear();
    this.sid = '';
    this.seq = 0;
  }

  apply(frame: SseFrame): FrameKind {
    const kind = kindOf(frame);
    if (kind === 'full') {
      const f = frame as Extract<SseFrame, { t: 'f' }>;
      this.map.clear();
      const nbt = f.n ?? {};
      f.d.forEach((row: any[], i: number) => {
        const [name, meta, count, craftable] = row;
        // 防御：服务端出 bug 时宁可少一条，也别让 null 流进 UI（会直接崩在 resolveItem）
        if (typeof name !== 'string') return;
        this.map.set(itemKey(name, meta), {
          item_name: name,
          meta,
          count,
          craftable: !!craftable,
          nbt: nbt[String(i)] ?? null,
        });
      });
      this.sid = f.sid;
      this.seq = f.seq;
    } else if (kind === 'delta') {
      const f = frame as Extract<SseFrame, { t: 'd' }>;
      (f.c ?? []).forEach((row: any[]) => {
        const [name, meta, count, craftable] = row;
        if (typeof name !== 'string') return;
        const k = itemKey(name, meta);
        const prev = this.map.get(k);
        this.map.set(k, {
          item_name: name,
          meta,
          count,
          craftable: !!craftable,
          nbt: prev?.nbt ?? null,
        });
      });
      (f.a ?? []).forEach((row: any[]) => {
        const [name, meta, count, craftable, nbt] = row;
        if (typeof name !== 'string') return;
        this.map.set(itemKey(name, meta), {
          item_name: name,
          meta,
          count,
          craftable: !!craftable,
          nbt: nbt ?? null,
        });
      });
      (f.x ?? []).forEach((row: any[]) => {
        if (typeof row?.[0] !== 'string') return;
        this.map.delete(itemKey(row[0], row[1]));
      });
      if (f.sid) this.sid = f.sid;
      this.seq = f.seq;
    }
    return kind;
  }

  list(): ItemStackResp[] {
    return Array.from(this.map.values());
  }

  get size(): number {
    return this.map.size;
  }

  /** 从落盘缓存恢复（缓存存的是完整数组） */
  seed(list: ItemStackResp[]): void {
    this.map.clear();
    list.forEach((it) => this.map.set(itemKey(it.item_name, it.meta), it));
  }
}

export class CpuAccumulator {
  private map = new Map<number, CraftingCPUInfo>();
  sid = '';
  seq = 0;

  reset(): void {
    this.map.clear();
    this.sid = '';
    this.seq = 0;
  }

  apply(frame: SseFrame): FrameKind {
    const kind = kindOf(frame);
    if (kind === 'full') {
      const f = frame as Extract<SseFrame, { t: 'f' }>;
      this.map.clear();
      const nbt = f.n ?? {};
      f.d.forEach((row: any[], i: number) => {
        const [idx, cpuName, storage, parallelism, item, meta, remaining] = row;
        this.map.set(idx, {
          idx,
          cpuName,
          storage,
          parallelism,
          item: item ?? null,
          meta,
          remainingCount: remaining,
          nbt: nbt[String(i)] ?? null,
        });
      });
      this.sid = f.sid;
      this.seq = f.seq;
    } else if (kind === 'delta') {
      const f = frame as Extract<SseFrame, { t: 'd' }>;
      (f.c ?? []).forEach((row: any[]) => {
        const [idx, remaining, item, meta] = row;
        const prev = this.map.get(idx);
        if (prev) {
          this.map.set(idx, { ...prev, remainingCount: remaining, item: item ?? null, meta });
        } else {
          // 没见过的 CPU（服务端新增），先占位，等下次全量补名字/容量
          this.map.set(idx, {
            idx,
            cpuName: `CPU #${idx}`,
            storage: 0,
            parallelism: 0,
            item: item ?? null,
            meta,
            remainingCount: remaining,
            nbt: null,
          });
        }
      });
      (f.x ?? []).forEach((idx: number) => this.map.delete(idx));
      if (f.sid) this.sid = f.sid;
      this.seq = f.seq;
    }
    return kind;
  }

  list(): CraftingCPUInfo[] {
    return Array.from(this.map.values()).sort((a, b) => a.idx - b.idx);
  }

  seed(list: CraftingCPUInfo[]): void {
    this.map.clear();
    list.forEach((c) => this.map.set(c.idx, c));
  }
}

export class TaskAccumulator {
  private map = new Map<string, CraftTaskItem>();
  sid = '';
  seq = 0;

  reset(): void {
    this.map.clear();
    this.sid = '';
    this.seq = 0;
  }

  apply(frame: SseFrame): FrameKind {
    const kind = kindOf(frame);
    if (kind === 'full') {
      const f = frame as Extract<SseFrame, { t: 'f' }>;
      this.map.clear();
      const nbt = f.n ?? {};
      f.d.forEach((row: any[], i: number) => {
        const [name, meta, present, sent, remaining, crafting, missing] = row;
        this.map.set(itemKey(name, meta), {
          name,
          meta,
          numberPresent: present,
          numberSent: sent,
          numberRemainingToCraft: remaining,
          crafting: !!crafting,
          missing,
          nbt: nbt[String(i)] ?? null,
        });
      });
      this.sid = f.sid;
      this.seq = f.seq;
    } else if (kind === 'delta') {
      const f = frame as Extract<SseFrame, { t: 'd' }>;
      (f.c ?? []).forEach((row: any[]) => {
        const [name, meta, sent, remaining] = row;
        if (typeof name !== 'string') return;
        const k = itemKey(name, meta);
        const prev = this.map.get(k);
        if (prev) {
          this.map.set(k, { ...prev, numberSent: sent, numberRemainingToCraft: remaining });
        } else {
          this.map.set(k, {
            name,
            meta,
            numberPresent: 0,
            numberSent: sent,
            numberRemainingToCraft: remaining,
            crafting: true,
            missing: 0,
            nbt: null,
          });
        }
      });
      (f.x ?? []).forEach((row: any[]) => {
        if (typeof row?.[0] !== 'string') return;
        this.map.delete(itemKey(row[0], row[1]));
      });
      if (f.sid) this.sid = f.sid;
      this.seq = f.seq;
    }
    return kind;
  }

  list(): CraftTaskItem[] {
    return Array.from(this.map.values());
  }

  seed(list: CraftTaskItem[]): void {
    this.map.clear();
    list.forEach((t) => this.map.set(itemKey(t.name, t.meta), t));
  }
}

export function frameError(frame: SseFrame): string | null {
  return frame.t === 'e' ? (frame as any).m ?? '服务器返回错误' : null;
}
