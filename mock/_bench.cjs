// 性能测量：itemsOnce / cpusOnce / plan 的往返耗时与体积
//
// 用法：AE_TOKEN=xxx node mock/_bench.cjs [host] [port] [次数]
// 说明：耗时包含网络往返 + 服务端主线程排队（每次请求至少等 1 tick = 50ms），
//       所以「单次 ms」可以粗略当成「占用主线程的时间 + 50ms」。
const net = require('node:net');
const { encodeFrame, FrameDecoder, T, PROTOCOL_VERSION } = require('./gen/net/protocol.js');
const { tcpAuth, setClockOffset } = require('./gen/auth.js');

const host = process.argv[2] || '127.0.0.1';
const port = Number(process.argv[3] || 44444);
const rounds = Number(process.argv[4] || 5);
const TOKEN = process.env.AE_TOKEN || '';
if (!TOKEN) { console.log('缺少 AE_TOKEN 环境变量'); process.exit(1); }

const s = net.createConnection({ host, port });
const dec = new FrameDecoder();
let nextId = 1;
const pending = new Map();
const streams = new Map();
let target = null;

const send = (t, p) => s.write(encodeFrame(t, p));
const request = (op, p) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  send(T.REQ, { id, op, p: p ?? {} });
});
const subscribe = (op, p) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  send(T.SUB, { id, op, p: p ?? {} });
});

async function bench(label, fn) {
  const times = [];
  let size = 0;
  for (let i = 0; i < rounds; i++) {
    const t0 = Date.now();
    const r = await fn();
    times.push(Date.now() - t0);
    if (r != null) size = r;
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`${label.padEnd(14)} 平均 ${avg.toFixed(0)}ms  最小 ${times[0]}ms  最大 ${times[times.length - 1]}ms` + (size ? `  体积 ${(size / 1024).toFixed(0)}KB` : ''));
}

s.on('connect', () => send(T.HELLO, { v: PROTOCOL_VERSION, app: 'bench' }));
s.on('error', (e) => { console.log('连接错误', e.code || e.message); process.exit(2); });

s.on('data', async (chunk) => {
  for (const f of dec.push(chunk)) {
    if (f.type === T.HELLO_ACK) {
      setClockOffset(f.payload.time - Date.now() / 1000);
      const ts = Math.floor(Date.now() / 1000) + Math.round(f.payload.time - Date.now() / 1000);
      const { kid, sig } = tcpAuth(TOKEN, ts, f.payload.nonce);
      send(T.AUTH, { kid, ts, sig });
    } else if (f.type === T.AUTH_FAIL) { console.log('鉴权失败', f.payload.code); process.exit(4); }
    else if (f.type === T.AUTH_OK) {
      const nets = await request('networks');
      const mons = nets.b ?? [];
      for (const m of mons) {
        const st = await subscribe('items', { ...m, craftableOnly: false });
        const first = await new Promise((resolve) => {
          const tick = () => { if (st.frames.length) { resolve(st.frames[0]); } else st.waiters.push(tick); };
          st.waiters.push(tick); tick();
        });
        if (first.t === 'e') { send(T.UNSUB, { s: st.id }); continue; }
        target = m;
        send(T.UNSUB, { s: st.id });
        break;
      }
      if (!target) { console.log('没有可用监控器'); process.exit(3); }
      console.log(`目标 DIM ${target.dimid} (${target.x},${target.y},${target.z})，每项 ${rounds} 次\n`);
      await bench('itemsOnce', async () => {
        const r = await request('itemsOnce', { ...target, craftableOnly: false });
        return r.ok && Array.isArray(r.b) ? JSON.stringify(r.b).length : null;
      });
      await bench('cpusOnce', async () => {
        const r = await request('cpusOnce', { ...target });
        return r.ok && Array.isArray(r.b) ? JSON.stringify(r.b).length : null;
      });
      await bench('plan(×1)', async () => {
        const r = await request('plan', { ...target, item: 'gregtech:gt.metaitem.01', meta: 2532, nbt: '', count: 64 });
        return r.ok ? JSON.stringify(r.b).length : null;
      });
      s.destroy();
      process.exit(0);
    } else if (f.type === T.SUB_OK) {
      const st = { id: f.payload.s, sid: f.payload.sid, frames: [], waiters: [] };
      streams.set(f.payload.s, st);
      pending.get(f.payload.id)?.(st);
      pending.delete(f.payload.id);
    } else if (f.type === T.PUSH) {
      const st = streams.get(f.payload.s);
      if (st) { st.frames.push(f.payload.f); st.waiters.slice().forEach((w) => w()); }
    } else if (f.type === T.RES) {
      const p = pending.get(f.payload.id);
      if (p) { pending.delete(f.payload.id); p({ ok: f.payload.ok, b: f.payload.b, m: f.payload.m }); }
    }
  }
});
setTimeout(() => { console.log('超时'); process.exit(2); }, 180000);
