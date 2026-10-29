// TPS/MSPT 功能验证（只读）：连真服务器，验证一次性请求 + 订阅 + 改订阅。
//
// 用法：node mock/tps.cjs <host> [port] <token>
//
// 依次验证：
//   1) REQ tps（dims=[0]）→ 91 个维度的清单 + 只有 dim 0 带 tick 数据 + 载荷大小
//   2) SUB tps（dims=[0]）→ 三帧，每帧约 200B，srv.mspt 合理
//   3) 换订阅（dims=[0,180]）→ 家园世界出现 tick 数据
//   4) 计时：每帧构造耗时（服务端 Metrics 里也有）
//
// 需要先编译协议模块到 mock/gen（见 doc/传输协议与安全.md §11）。
const net = require('node:net');
const { encodeFrame, FrameDecoder, T, PROTOCOL_VERSION } = require('./gen/net/protocol.js');
const { tcpAuth, setClockOffset } = require('./gen/auth.js');

const host = process.argv[2] || '127.0.0.1';
const port = Number(process.argv[3] || 44444);
const token = process.argv[4] || '';

if (!token) {
  console.log('用法: node mock/tps.cjs <host> [port] <token>');
  process.exit(1);
}

const log = (...a) => console.log(...a);
let failures = 0;
function check(name, cond, extra) {
  if (cond) log(`  ✓ ${name}`);
  else {
    failures++;
    log(`  ✗ ${name}`, extra ?? '');
  }
}

const socket = net.createConnection({ host, port });
const decoder = new FrameDecoder();
let nextId = 1;
const pending = new Map();
const streams = new Map();

const hardTimeout = setTimeout(() => {
  log('\n❌ 超时退出');
  socket.destroy();
  process.exit(2);
}, 90000);

function send(type, payload) {
  socket.write(encodeFrame(type, payload));
}

function request(op, p) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    send(T.REQ, { id, op, p: p ?? {} });
  });
}

function subscribe(op, p) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    send(T.SUB, { id, op, p: p ?? {} });
  });
}

function waitFrame(stream, index, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (stream.frames.length > index) return resolve(stream.frames[index]);
      if (Date.now() - t0 > timeoutMs) return reject(new Error(`等第 ${index + 1} 帧超时`));
      setTimeout(tick, 100);
    };
    tick();
  });
}

function unsubscribe(stream) {
  send(T.UNSUB, { s: stream.id });
}

socket.on('connect', () => send(T.HELLO, { v: PROTOCOL_VERSION, app: 'tps-test/1.0' }));
socket.on('error', (e) => {
  log(`❌ 连接错误：${e.code || e.message}`);
  process.exit(2);
});

socket.on('data', async (chunk) => {
  for (const f of decoder.push(chunk)) {
    if (f.type === T.HELLO_ACK) {
      setClockOffset(f.payload.time - Date.now() / 1000);
      const ts = Math.floor(Date.now() / 1000) + Math.round(f.payload.time - Date.now() / 1000);
      const { kid, sig } = tcpAuth(token, ts, f.payload.nonce);
      send(T.AUTH, { kid, ts, sig });
    } else if (f.type === T.AUTH_OK) {
      run().catch((e) => {
        log('❌ 测试异常：', e.message);
        process.exit(1);
      });
    } else if (f.type === T.AUTH_FAIL) {
      log(`❌ AUTH_FAIL code=${f.payload.code}`);
      process.exit(4);
    } else if (f.type === T.RES) {
      const p = pending.get(f.payload.id);
      if (!p) continue;
      pending.delete(f.payload.id);
      p.resolve({ ok: f.payload.ok, b: f.payload.b, m: f.payload.m });
    } else if (f.type === T.SUB_OK) {
      const p = pending.get(f.payload.id);
      pending.delete(f.payload.id);
      const stream = { id: f.payload.s, frames: [] };
      streams.set(f.payload.s, stream);
      p?.resolve(stream);
    } else if (f.type === T.PUSH) {
      const s = streams.get(f.payload.s);
      if (s) s.frames.push(f.payload.f);
    }
  }
});

async function run() {
  log('\n[1] 一次性请求 tps（dims=[0]）');
  const t0 = Date.now();
  const full = await request('tps', { dims: [0] });
  const ms = Date.now() - t0;
  check('ok=true', full.ok, full.m);
  const body = full.b || {};
  const worlds = body.w || [];
  check(`返回世界清单（${worlds.length} 个）`, worlds.length > 5);
  check('srv 有 mspt/tps', typeof body.srv?.mspt === 'number' && typeof body.srv?.tps === 'number');
  const withTick = worlds.filter((w) => w.mspt != null);
  check(`只有 dim 0 带 tick 数据（实际 ${withTick.map((w) => w.id).join(',')}）`, withTick.length === 1 && withTick[0].id === 0);
  check('清单带显示名', worlds.every((w) => typeof w.d === 'string' && w.d.length > 0));
  check('有家园世界标记', worlds.some((w) => w.pm === 1));
  const bytes = Buffer.byteLength(JSON.stringify(body));
  log(`    载荷 ${bytes}B，耗时 ${ms}ms`);
  log(`    srv: TPS ${body.srv.tps} / MSPT ${body.srv.mspt} / MAX ${body.srv.max} / ${body.srv.players} 人`);
  log(`    dim0: ${worlds.find((w) => w.id === 0)?.d} mspt=${worlds.find((w) => w.id === 0)?.mspt}`);
  log(`    家园: ${worlds.filter((w) => w.pm === 1).map((w) => `${w.d}(${w.id})`).join(', ')}`);
  log(`    样例: ${worlds.slice(0, 6).map((w) => `${w.id}:${w.d}`).join(' | ')}`);
  check('一次性载荷 < 40KB', bytes < 40000, `${bytes}B`);

  log('\n[2] 订阅 tps（dims=[0]），等 3 帧');
  const s1 = await subscribe('tps', { dims: [0] });
  const f1 = await waitFrame(s1, 0);
  const f2 = await waitFrame(s1, 1);
  const f3 = await waitFrame(s1, 2);
  const sz = Buffer.byteLength(JSON.stringify(f1));
  log(`    帧 1: t=${f1.t} ts=${f1.ts} w=${(f1.w || []).length} 个维度, ${sz}B`);
  log(`    srv: TPS ${f1.srv.tps} / MSPT ${f1.srv.mspt} / ticks ${f1.srv.ticks}`);
  check('帧类型 f', f1.t === 'f');
  check('只带被检测维度', (f1.w || []).length === 1 && f1.w[0].id === 0, JSON.stringify(f1.w));
  check('帧载荷 < 1KB', sz < 1024, `${sz}B`);
  check('mspt 合理（0 < mspt < 500）', f1.srv.mspt > 0 && f1.srv.mspt < 500, f1.srv.mspt);
  check('ts 递增', f2.ts > f1.ts && f3.ts > f2.ts);
  check('推送间隔约 5 秒', f2.ts - f1.ts >= 4000 && f2.ts - f1.ts <= 6500, `${f2.ts - f1.ts}ms`);
  unsubscribe(s1);

  log('\n[3] 换成 dims=[0,180]，家园世界应出现 tick 数据');
  const s2 = await subscribe('tps', { dims: [0, 180] });
  const g1 = await waitFrame(s2, 0);
  const ids = (g1.w || []).map((w) => w.id).sort((a, b) => a - b);
  check(`订阅里有两个维度（${ids.join(',')}）`, ids.length === 2 && ids.includes(0) && ids.includes(180));
  const home = (g1.w || []).find((w) => w.id === 180);
  check('家园世界有 mspt', !!home && typeof home.mspt === 'number', JSON.stringify(home));
  log(`    dim180: mspt=${home?.mspt} max=${home?.max} tps=${home?.tps}`);
  unsubscribe(s2);

  clearTimeout(hardTimeout);
  log(failures === 0 ? '\n✅ 全部通过' : `\n❌ ${failures} 项失败`);
  socket.destroy();
  process.exit(failures === 0 ? 0 : 1);
}
