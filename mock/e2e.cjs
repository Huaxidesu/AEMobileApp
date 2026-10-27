// 端到端对拍：用 App 真实的 auth.ts / protocol.ts（已编译到 /tmp/aejs）连 mock 的 TCP 服务端。
// 覆盖：握手 → 错误签名 → 正确签名 → 一次性请求 → 三条订阅（全量+增量）→ 计划进度 → 下单/取消。
const net = require('node:net');
const { tcpAuth, setClockOffset } = require('./gen/auth.js');
const { encodeFrame, FrameDecoder, T, PROTOCOL_VERSION } = require('./gen/net/protocol.js');

const HOST = '127.0.0.1';
const PORT = Number(process.argv[2] || 44444);
const TOKEN = 'MOCKTOKEN234567ABCDEFGHJKLM';

const log = (...a) => console.log(...a);
let failures = 0;
function check(name, cond, extra) {
  if (cond) log(`  ✓ ${name}`);
  else {
    failures++;
    log(`  ✗ ${name}`, extra ?? '');
  }
}

function open(token) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port: PORT }, () => {
      socket.write(encodeFrame(T.HELLO, { v: PROTOCOL_VERSION, app: 'e2e' }));
    });
    const decoder = new FrameDecoder();
    const handlers = [];
    const state = { authed: false, nonce: '', subs: new Map(), pending: new Map(), nextId: 1, events: [] };

    const send = (type, payload) => socket.write(encodeFrame(type, payload));

    socket.on('data', (chunk) => {
      for (const f of decoder.push(chunk)) {
        if (f.type === T.HELLO_ACK) {
          state.nonce = f.payload.nonce;
          setClockOffset(f.payload.time - Date.now() / 1000);
          const ts = Math.floor(Date.now() / 1000) + Math.round(f.payload.time - Date.now() / 1000);
          const { kid, sig } = tcpAuth(token, ts, state.nonce);
          send(T.AUTH, { kid, ts, sig });
        } else if (f.type === T.AUTH_OK) {
          state.authed = true;
          resolve({ socket, state, send, on: (fn) => handlers.push(fn) });
        } else if (f.type === T.AUTH_FAIL) {
          reject(Object.assign(new Error(f.payload?.code ?? 'AUTH_FAILED'), { code: f.payload?.code }));
        } else if (f.type === T.ERR) {
          reject(new Error(f.payload?.m));
        }
        handlers.forEach((fn) => fn(f));
      }
    });
    socket.on('error', reject);
  });
}

function request(conn, op, p, onProgress) {
  return new Promise((resolve, reject) => {
    const id = conn.state.nextId++;
    conn.state.pending.set(id, { resolve, reject, onProgress });
    conn.send(T.REQ, { id, op, p: p ?? {} });
  });
}

function subscribe(conn, op, p) {
  return new Promise((resolve) => {
    const id = conn.state.nextId++;
    conn.state.pending.set(id, { resolve });
    conn.send(T.SUB, { id, op, p: p ?? {} });
  });
}

(async () => {
  log('\n=== 1. 错误签名必须被拒 ===');
  try {
    await open('WRONGTOKEN234567ABCDEFGHJK');
    check('错误 token 被拒', false, '竟然通过了');
  } catch (e) {
    check(`错误 token 被拒（${e.code ?? e.message}）`, e.code === 'AUTH_FAILED' || e.message === 'AUTH_FAILED');
  }

  log('\n=== 2. 正确签名握手 ===');
  const conn = await open(TOKEN);
  check('AUTH_OK', conn.state.authed);

  // 统一处理 RES / PUSH
  conn.on((f) => {
    if (f.type === T.RES) {
      const p = conn.state.pending.get(f.payload.id);
      if (!p) return;
      if (f.payload.more) {
        p.onProgress?.(f.payload.b);
        return;
      }
      conn.state.pending.delete(f.payload.id);
      p.resolve({ ok: f.payload.ok, b: f.payload.b, m: f.payload.m });
    } else if (f.type === T.SUB_OK) {
      const p = conn.state.pending.get(f.payload.id);
      conn.state.pending.delete(f.payload.id);
      p?.resolve(f.payload);
    } else if (f.type === T.PUSH) {
      const s = conn.state.subs.get(f.payload.s);
      s?.frames.push(f.payload.f);
      s?.waiters.splice(0).forEach((w) => w());
    }
  });

  log('\n=== 3. 一次性请求 ===');
  const net1 = await request(conn, 'networks');
  check('networks ok', net1.ok && Array.isArray(net1.b) && net1.b.length === 1, JSON.stringify(net1));
  const cpus = await request(conn, 'cpusOnce');
  check(`cpusOnce 返回 ${cpus.b?.length} 台 CPU`, cpus.ok && cpus.b.length === 6);
  const mspt = await request(conn, 'mspt');
  check('mspt 回 NOT_SUPPORTED（App 走空态）', !mspt.ok && mspt.m === 'NOT_SUPPORTED');

  log('\n=== 4. items 订阅：首帧全量 + 之后增量 ===');
  const itemsSub = await subscribe(conn, 'items', { dimid: 0, x: 1024, y: 64, z: -512, craftableOnly: false });
  check('SUB_OK 带 sid', !!itemsSub.sid);
  const items = { frames: [], waiters: [] };
  conn.state.subs.set(itemsSub.s, items);
  await new Promise((r) => items.waiters.push(r));
  const full = items.frames[0];
  check(`首帧 t=${full.t}，${full.d.length} 条`, full.t === 'f' && full.d.length > 900);
  log(`    首帧 JSON 大小 ${JSON.stringify(full).length} B`);
  // 等一帧增量（mock 每 30s 推一次，这里直接手动触发不了，改成等 31s 太慢 → 用 cpus 的 5s 流验证增量）
  log('    （items 间隔 30s，增量留给下面的 cpus 流验证）');

  log('\n=== 5. cpus 订阅：全量 + 5s 后的增量 ===');
  const cpuSub = await subscribe(conn, 'cpus', { dimid: 0, x: 1024, y: 64, z: -512 });
  const cpuStream = { frames: [], waiters: [] };
  conn.state.subs.set(cpuSub.s, cpuStream);
  await new Promise((r) => cpuStream.waiters.push(r));
  check(`首帧 t=${cpuStream.frames[0].t}`, cpuStream.frames[0].t === 'f');
  await new Promise((r) => cpuStream.waiters.push(r)); // 等第二帧
  const second = cpuStream.frames[1];
  check(`第二帧 t=${second.t}（d=增量 / k=心跳）`, second.t === 'd' || second.t === 'k', JSON.stringify(second).slice(0, 120));
  log(`    第二帧 JSON 大小 ${JSON.stringify(second).length} B`);

  log('\n=== 6. details 订阅（2s 一帧）===');
  const detailSub = await subscribe(conn, 'details', { dimid: 0, x: 1024, y: 64, z: -512, cpuid: 0 });
  const detailStream = { frames: [], waiters: [] };
  conn.state.subs.set(detailSub.s, detailStream);
  await new Promise((r) => detailStream.waiters.push(r));
  check(`details 首帧 t=${detailStream.frames[0].t}`, detailStream.frames[0].t === 'f');
  await new Promise((r) => detailStream.waiters.push(r));
  check(`details 第二帧 t=${detailStream.frames[1].t}`, ['d', 'k'].includes(detailStream.frames[1].t));

  log('\n=== 7. 生成计划：进度帧 + 最终帧 ===');
  const progress = [];
  const plan = await request(conn, 'plan', { dimid: 0, x: 1024, y: 64, z: -512, item: 'minecraft:stone', meta: 0, nbt: '', count: 64 }, (b) => {
    progress.push(b);
  });
  check(`收到 ${progress.length} 条进度`, progress.length >= 2, JSON.stringify(progress.slice(0, 2)));
  check('最终帧是计划对象', plan.ok && Array.isArray(plan.b?.plan) && plan.b.plan.length > 0);

  log('\n=== 8. 下单 + 取消 ===');
  const start = await request(conn, 'start', {
    dimid: 0, x: 1024, y: 64, z: -512,
    item: 'minecraft:stone', meta: 0, nbt: '', count: 64, cpuId: 1, allowMissing: true,
  });
  check('start ok', start.ok && start.b === 'Success', JSON.stringify(start));
  const busy = await request(conn, 'start', {
    dimid: 0, x: 1024, y: 64, z: -512,
    item: 'minecraft:stone', meta: 0, nbt: '', count: 64, cpuId: 1, allowMissing: true,
  });
  check('同一台 CPU 再下单被拒', !busy.ok, JSON.stringify(busy));
  const cancel = await request(conn, 'cancel', { dimid: 0, x: 1024, y: 64, z: -512, cpuid: 1 });
  check('cancel ok', cancel.ok);

  log('\n=== 9. 未鉴权连接不能请求 ===');
  const raw = net.createConnection({ host: HOST, port: PORT });
  await new Promise((r) => raw.on('connect', r));
  const decoder2 = new FrameDecoder();
  let unauthorized = null;
  raw.on('data', (c) => {
    for (const f of decoder2.push(c)) {
      if (f.type === T.RES) unauthorized = f.payload;
    }
  });
  raw.write(encodeFrame(T.REQ, { id: 99, op: 'networks', p: {} }));
  await new Promise((r) => setTimeout(r, 300));
  check('未鉴权请求被拒', unauthorized && unauthorized.ok === false && unauthorized.m === 'AUTH_REQUIRED', JSON.stringify(unauthorized));
  raw.destroy();

  conn.socket.destroy();
  log(failures === 0 ? '\n全部通过 ✅' : `\n有 ${failures} 项失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
