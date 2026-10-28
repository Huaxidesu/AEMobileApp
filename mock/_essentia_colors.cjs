// 拉一遍源质，把每个 aspect 的 tag / 名字 / 颜色（NBT 里的 Color）打出来
const net = require('node:net');
const { encodeFrame, FrameDecoder, T, PROTOCOL_VERSION } = require('./gen/net/protocol.js');
const { tcpAuth, setClockOffset } = require('./gen/auth.js');
const TOKEN = process.env.AE_TOKEN || '';
const s = net.createConnection({ host: '127.0.0.1', port: 44444 });
const dec = new FrameDecoder();
let nextId = 1; const pending = new Map(); const streams = new Map();
const send = (t, p) => s.write(encodeFrame(t, p));
const request = (op, p) => new Promise((r) => { const id = nextId++; pending.set(id, r); send(T.REQ, { id, op, p: p ?? {} }); });
const subscribe = (op, p) => new Promise((r) => { const id = nextId++; pending.set(id, r); send(T.SUB, { id, op, p: p ?? {} }); });

function parseNbt(buf) {
  let i = 0;
  const readName = () => { const l = buf.readUInt16BE(i); i += 2; const s = buf.toString('utf8', i, i + l); i += l; return s; };
  const out = {};
  i = 1; readName(); // root compound
  while (i < buf.length) {
    const t = buf[i++];
    if (t === 0) break;
    const name = readName();
    if (t === 8) { const l = buf.readUInt16BE(i); i += 2; out[name] = buf.toString('utf8', i, i + l); i += l; }
    else if (t === 3) { out[name] = buf.readInt32BE(i); i += 4; }
    else break;
  }
  return out;
}

s.on('connect', () => send(T.HELLO, { v: PROTOCOL_VERSION, app: 'colors' }));
s.on('data', async (chunk) => {
  for (const f of dec.push(chunk)) {
    if (f.type === T.HELLO_ACK) {
      setClockOffset(f.payload.time - Date.now() / 1000);
      const ts = Math.floor(Date.now() / 1000) + Math.round(f.payload.time - Date.now() / 1000);
      const { kid, sig } = tcpAuth(TOKEN, ts, f.payload.nonce);
      send(T.AUTH, { kid, ts, sig });
    } else if (f.type === T.AUTH_OK) {
      const nets = await request('networks');
      for (const m of nets.b ?? []) {
        const st = await subscribe('items', { ...m, craftableOnly: false });
        const first = await new Promise((res) => { const tick = () => { if (st.frames.length) res(st.frames[0]); else st.waiters.push(tick); }; st.waiters.push(tick); tick(); });
        if (first.t === 'e') { send(T.UNSUB, { s: st.id }); continue; }
        const nbtMap = first.n ?? {};
        const rows = [];
        first.d.forEach((r, idx) => {
          if (r[0] !== 'thaumicenergistics:essentia') return;
          const b64 = nbtMap[String(idx)];
          if (!b64) return;
          const o = parseNbt(Buffer.from(b64, 'base64'));
          rows.push({ tag: o.Aspect, name: o.Name, color: o.Color, count: r[2] });
        });
        console.log(JSON.stringify(rows, null, 0));
        process.exit(0);
      }
    } else if (f.type === T.SUB_OK) {
      const st = { id: f.payload.s, frames: [], waiters: [] };
      streams.set(f.payload.s, st); pending.get(f.payload.id)?.(st); pending.delete(f.payload.id);
    } else if (f.type === T.PUSH) {
      const st = streams.get(f.payload.s); if (st) { st.frames.push(f.payload.f); st.waiters.slice().forEach((w) => w()); }
    } else if (f.type === T.RES) {
      const p = pending.get(f.payload.id); if (p) { pending.delete(f.payload.id); p({ ok: f.payload.ok, b: f.payload.b }); }
    }
  }
});
setTimeout(() => process.exit(2), 40000);
