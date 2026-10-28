// 统计网络里的「流体滴 / 源质」条目：多少条、都是什么流体、App 能不能认出来
//
// 用法：AE_TOKEN=xxx node mock/_fluids.cjs [host] [port] [输出 json]
// 输出：fluid_drop 条数、按流体名聚合的数量、以及 NBT 里读到的原始字段（调试用）
const net = require('node:net');
const fs = require('node:fs');
const { encodeFrame, FrameDecoder, T, PROTOCOL_VERSION } = require('./gen/net/protocol.js');
const { tcpAuth, setClockOffset } = require('./gen/auth.js');

const host = process.argv[2] || '127.0.0.1';
const port = Number(process.argv[3] || 44444);
const out = process.argv[4] || 'mock/_fluids.json';
const TOKEN = process.env.AE_TOKEN || '';
if (!TOKEN) { console.log('缺少 AE_TOKEN 环境变量'); process.exit(1); }

const s = net.createConnection({ host, port });
const dec = new FrameDecoder();
let nextId = 1;
const pending = new Map();
const streams = new Map();

const send = (t, p) => s.write(encodeFrame(t, p));
const request = (op, p) => new Promise((res) => { const id = nextId++; pending.set(id, res); send(T.REQ, { id, op, p: p ?? {} }); });
const subscribe = (op, p) => new Promise((res) => { const id = nextId++; pending.set(id, res); send(T.SUB, { id, op, p: p ?? {} }); });

/** 从 NBT 字节流里抠出可打印串（够用：找 "Fluid" 这个 key 后面的字符串值） */
function stringsOf(buf) {
  const txt = buf.toString('utf8');
  const runs = txt.match(/[\x20-\x7e]{3,64}/g) || [];
  const m = /Fluid[\s\S]{0,3}([\x20-\x7e]{3,64})/.exec(txt);
  return m ? [`Fluid=${m[1]}`, ...runs.slice(0, 6)] : runs.slice(0, 8);
}

s.on('connect', () => send(T.HELLO, { v: PROTOCOL_VERSION, app: 'fluids' }));
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
      for (const m of nets.b ?? []) {
        const st = await subscribe('items', { ...m, craftableOnly: false });
        const first = await new Promise((resolve) => {
          const tick = () => { if (st.frames.length) resolve(st.frames[0]); else st.waiters.push(tick); };
          st.waiters.push(tick); tick();
        });
        if (first.t === 'e') { send(T.UNSUB, { s: st.id }); continue; }
        const nbtMap = first.n ?? {};
        const rows = [];
        first.d.forEach((r, i) => {
          const b64 = nbtMap[String(i)];
          if (!b64) return;
          const buf = Buffer.from(b64, 'base64');
          const strs = stringsOf(buf);
          rows.push({ i, name: r[0], meta: r[1], count: r[2], craftable: r[3], nbtBytes: buf.length, strings: strs.slice(0, 8) });
        });
        const byName = {};
        rows.forEach((r) => { byName[r.name] = (byName[r.name] || 0) + 1; });
        console.log(`监控器 DIM ${m.dimid} (${m.x},${m.y},${m.z})：物品 ${first.d.length} 条，带 NBT 的 ${rows.length} 条`);
        console.log('带 NBT 的物品名分布：', byName);
        console.log('前 5 条带 NBT 的样例：');
        rows.slice(0, 5).forEach((r) => console.log(`  ${r.name}:${r.meta} ×${r.count}  NBT(${r.nbtBytes}B) 串=${JSON.stringify(r.strings)}`));
        fs.writeFileSync(out, JSON.stringify({ monitor: m, total: first.d.length, rows }, null, 1));
        console.log(`已写入 ${out}`);
        s.destroy();
        process.exit(0);
      }
      console.log('没有可用监控器'); process.exit(3);
    } else if (f.type === T.SUB_OK) {
      const st = { id: f.payload.s, frames: [], waiters: [] };
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
