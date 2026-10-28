// 并发压测：模拟 N 个 App 同时请求（plan / cpusOnce / itemsOnce），看服务端排队情况
//
// 用法：AE_TOKEN=xxx node mock/_load.cjs [host] [port] [客户端数] [每客户端轮数] [模式]
//   模式：plan（默认）| cpus | items | mixed
// 输出：每个请求的往返耗时分布。注意每次请求至少要等 1 个 tick（50ms），
//       所以 p95 明显超过 100ms 就说明主线程在排队。
const net = require('node:net');
const { encodeFrame, FrameDecoder, T, PROTOCOL_VERSION } = require('./gen/net/protocol.js');
const { tcpAuth, setClockOffset } = require('./gen/auth.js');

const host = process.argv[2] || '127.0.0.1';
const port = Number(process.argv[3] || 44444);
const CLIENTS = Number(process.argv[4] || 8);
const ROUNDS = Number(process.argv[5] || 5);
const MODE = process.argv[6] || 'plan';
const ITEM = process.env.ITEM || 'gregtech:gt.metaitem.01';
const META = Number(process.env.META || 2532);
const TOKEN = process.env.AE_TOKEN || '';
if (!TOKEN) { console.log('缺少 AE_TOKEN 环境变量'); process.exit(1); }

function makeClient(idx) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port });
    const dec = new FrameDecoder();
    let nextId = 1;
    const pending = new Map();
    const streams = new Map();
    const times = [];
    let target = null;

    const send = (t, p) => s.write(encodeFrame(t, p));
    const request = (op, p) => new Promise((res) => {
      const id = nextId++;
      pending.set(id, res);
      send(T.REQ, { id, op, p: p ?? {} });
    });
    const subscribe = (op, p) => new Promise((res) => {
      const id = nextId++;
      pending.set(id, res);
      send(T.SUB, { id, op, p: p ?? {} });
    });

    s.on('connect', () => send(T.HELLO, { v: PROTOCOL_VERSION, app: 'load-' + idx }));
    s.on('error', () => resolve({ idx, times, error: 'connect' }));

    s.on('data', async (chunk) => {
      for (const f of dec.push(chunk)) {
        if (f.type === T.HELLO_ACK) {
          setClockOffset(f.payload.time - Date.now() / 1000);
          const ts = Math.floor(Date.now() / 1000) + Math.round(f.payload.time - Date.now() / 1000);
          const { kid, sig } = tcpAuth(TOKEN, ts, f.payload.nonce);
          send(T.AUTH, { kid, ts, sig });
        } else if (f.type === T.AUTH_OK) {
          const nets = await request('networks');
          // 登记表里有陈旧坐标，先用 cpusOnce 探一下，挑真正可用的那个监控器
          for (const m of nets.b ?? []) {
            const probe = await request('cpusOnce', { ...m });
            if (probe.ok) { target = m; break; }
          }
          if (!target) { console.log(`客户端 ${idx}: 没有可用监控器`); process.exit(3); }
          for (let i = 0; i < ROUNDS; i++) {
            const t0 = Date.now();
            if (MODE === 'plan' || (MODE === 'mixed' && i % 3 === 0)) {
              await request('plan', { ...target, item: ITEM, meta: META, nbt: '', count: 64 });
            } else if (MODE === 'items') {
              await request('itemsOnce', { ...target, craftableOnly: false });
            } else {
              await request('cpusOnce', { ...target });
            }
            times.push(Date.now() - t0);
          }
          s.destroy();
          resolve({ idx, times });
        } else if (f.type === T.SUB_OK) {
          const st = { id: f.payload.s, frames: [], waiters: [] };
          streams.set(f.payload.s, st);
          pending.get(f.payload.id)?.(st);
          pending.delete(f.payload.id);
        } else if (f.type === T.RES) {
          const p = pending.get(f.payload.id);
          if (p) { pending.delete(f.payload.id); p({ ok: f.payload.ok, b: f.payload.b, m: f.payload.m }); }
        }
      }
    });
  });
}

(async () => {
  console.log(`${CLIENTS} 个客户端 × ${ROUNDS} 轮，模式 ${MODE}，同时开打…`);
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: CLIENTS }, (_, i) => makeClient(i)));
  const all = results.flatMap((r) => r.times).sort((a, b) => a - b);
  const wall = Date.now() - t0;
  if (!all.length) { console.log('没有拿到结果', results.map((r) => r.error)); process.exit(1); }
  const pick = (q) => all[Math.min(all.length - 1, Math.floor(all.length * q))];
  const avg = all.reduce((a, b) => a + b, 0) / all.length;
  console.log(`请求数 ${all.length}，总耗时 ${wall}ms`);
  console.log(`单请求耗时：平均 ${avg.toFixed(0)}ms  p50 ${pick(0.5)}ms  p95 ${pick(0.95)}ms  最大 ${all[all.length - 1]}ms`);
  process.exit(0);
})();
