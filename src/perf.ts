// 轻量计时工具：给关键路径打点，日志走 console.log（release 包里 logcat 也能看到）。
//
// 为什么不用 performance.now()：Hermes 上 global.performance 不一定存在，
// Date.now() 的毫秒精度对「几百毫秒级」的耗时判断完全够用，且零依赖。
const ENABLED = true;

export function now(): number {
  return Date.now();
}

export function perfLog(tag: string, ...args: any[]): void {
  if (!ENABLED) return;
  console.log('[perf]', tag, ...args);
}

/** 包一段同步逻辑并打印耗时（返回值原样透传） */
export function timed<T>(tag: string, fn: () => T, detail?: () => any): T {
  const t0 = now();
  const out = fn();
  if (ENABLED) {
    const ms = now() - t0;
    if (ms >= 8) console.log('[perf]', tag, `${ms}ms`, detail ? detail() : '');
  }
  return out;
}
