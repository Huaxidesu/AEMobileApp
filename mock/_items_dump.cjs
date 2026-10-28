// 把服务器网络里的物品清单 dump 成 JSON，用于离线统计（比如「有多少物品本地图标库没有」）
//
// 用法：AE_TOKEN=xxx node mock/_items_dump.cjs [host] [port] [输出文件]
// 输出：[{"n":"模组:物品名","m":meta,"c":数量,"cr":可合成}, ...]
const net = require('node:net');
const fs = require('node:fs');
const { encodeFrame, FrameDecoder, T, PROTOCOL_VERSION } = require('./gen/net/protocol.js');
const { tcpAuth, setClockOffset } = require('./gen/auth.js');

const host = process.argv[2] || '127.0.0.1';
const port = Number(process.argv[3] || 44444);
const outFile = process.argv[4] || 'mock/_items.json';
const TOKEN = process.env.AE_TOKEN || '';
if (!TOKEN) { console.log('缺少 AE_TOKEN 环境变量'); process.exit(1); }

const s = net.createConnection({ host, port });
const dec = new FrameDecoder();
let nextId = 1;
const pending = new Map();
const streams = new Map();

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

s.on('connect', () => send(T.HELLO, { v: PROTOCOL_VERSION, app: 'items-dump' }));
s.on('error', (e) => { console.log('连接错误', e.code || e.message); process.exit(2); });

s.on('data', async (chunk) => {
  for (const f of dec.push(chunk)) {
    if (f.type === T.HELLO_ACK) {
      setClockOffset(f.payload.time - Date.now() / 1000);
      const ts = Math.floor(Date.now() / 1000) + Math.round(f.payload.time - Date.now() / 1000);
      const { kid, sig } = tcpAuth(TOKEN, ts, f.payload.nonce);
      send(T.AUTH, { kid, ts, sig });
    } else if (f.type === T.AUTH_FAIL) {
      console.log('鉴权失败', f.payload.code); process.exit(4);
    } else if (f.type === T.AUTH_OK) {
      const nets = await request('networks');
      const monitors = nets.b ?? [];
      let target = null;
      for (const m of monitors) {
        const st = await subscribe('items', { ...m, craftableOnly: false });
        // 等第一帧：t='e' 说明这个坐标不可用
        const first = await new Promise((resolve) => {
          const tick = () => {
            if (st.frames.length) { st.waiters = []; resolve(st.frames[0]); } else st.waiters.push(tick);
          };
          st.waiters.push(tick); tick();
        });
        if (first.t === 'e') { send(T.UNSUB, { s: st.id }); continue; }
        target = m;
        const items = first.d.map((r) => ({ n: r[0], m: r[1], c: r[2], cr: r[3] === true }));
        fs.writeFileSync(outFile, JSON.stringify({ monitor: m, count: items.length, items }));
        console.log(`DIM ${m.dimid} (${m.x},${m.y},${m.z}) → ${items.length} 条，写入 ${outFile}`);
        s.destroy();
        process.exit(0);
      }
      console.log('没有可用的监控器'); process.exit(3);
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
setTimeout(() => { console.log('超时'); process.exit(2); }, 60000);
