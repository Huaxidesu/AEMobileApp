// 真服务器功能验证（只读，不会下单/取消）。
//
// 用法：node mock/live.cjs <host> [port] <token>
//
// 依次验证：握手 → 鉴权 → 监控器列表 → items 全量/增量 → CPU 列表 → 任务明细（若有运行中任务）
// 每一步打印真实数据（条目数、帧大小），用于确认服务端在真实 AE2 数据下正常。
//
// 需要先编译协议模块到 mock/gen（见 doc/传输协议与安全.md §11）。
const net = require('node:net');
const { encodeFrame, FrameDecoder, T, PROTOCOL_VERSION } = require('./gen/net/protocol.js');
const { tcpAuth, setClockOffset } = require('./gen/auth.js');

const host = process.argv[2] || '127.0.0.1';
const port = Number(process.argv[3] || 44444);
const token = process.argv[4] || '';

if (!token) {
  console.log('用法: node mock/live.cjs <host> [port] <token>');
  process.exit(1);
}

const log = (...a) => console.log(...a);
const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`);

const socket = net.createConnection({ host, port });
const decoder = new FrameDecoder();
let nextId = 1;
const pending = new Map();
const streams = new Map();
let seq = 0;

const hardTimeout = setTimeout(() => {
  log('\n❌ 超时退出');
  socket.destroy();
  process.exit(2);
}, 60000);

function send(type, payload) {
  socket.write(encodeFrame(type, payload));
}

function request(op, p, onProgress) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
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

function waitFrame(stream, index) {
  return new Promise((resolve) => {
    const check = () => {
      if (stream.frames.length > index) {
        stream.waiters = stream.waiters.filter((w) => w !== check);
        resolve(stream.frames[index]);
      }
    };
    stream.waiters.push(check);
    check();
  });
}

socket.on('connect', () => {
  log(`[1] 连接 ${host}:${port} 成功，发 HELLO`);
  send(T.HELLO, { v: PROTOCOL_VERSION, app: 'live-test/1.0' });
});

socket.on('error', (e) => {
  log(`❌ 连接错误：${e.code || e.message}`);
  process.exit(2);
});

socket.on('data', async (chunk) => {
  for (const f of decoder.push(chunk)) {
    if (f.type === T.HELLO_ACK) {
      setClockOffset(f.payload.time - Date.now() / 1000);
      log(`[2] HELLO_ACK v=${f.payload.v} ver=${f.payload.ver}（时钟偏差 ${Math.round(f.payload.time - Date.now() / 1000)}s）`);
      const ts = Math.floor(Date.now() / 1000) + Math.round(f.payload.time - Date.now() / 1000);
      const { kid, sig } = tcpAuth(token, ts, f.payload.nonce);
      send(T.AUTH, { kid, ts, sig });
    } else if (f.type === T.AUTH_OK) {
      log('[3] ✅ AUTH_OK');
      run().catch((e) => {
        log('❌ 测试异常：', e.message);
        process.exit(1);
      });
    } else if (f.type === T.AUTH_FAIL) {
      log(`[3] ❌ AUTH_FAIL code=${f.payload.code}`);
      if (f.payload.code === 'AUTH_FAILED') {
        log('    密码不对，或者这个 token 还没被服务端注册。');
        log('    注册条件：监控器所在区块被加载过一次（玩家走到附近 / 区块加载器）。');
      }
      process.exit(4);
    } else if (f.type === T.RES) {
      const p = pending.get(f.payload.id);
      if (!p) continue;
      if (f.payload.more) {
        p.onProgress?.(f.payload.b);
        continue;
      }
      pending.delete(f.payload.id);
      p.resolve({ ok: f.payload.ok, b: f.payload.b, m: f.payload.m });
    } else if (f.type === T.SUB_OK) {
      const p = pending.get(f.payload.id);
      pending.delete(f.payload.id);
      const stream = { id: f.payload.s, sid: f.payload.sid, frames: [], waiters: [] };
      streams.set(f.payload.s, stream);
      p?.resolve(stream);
    } else if (f.type === T.PUSH) {
      const s = streams.get(f.payload.s);
      if (!s) continue;
      s.frames.push(f.payload.f);
      s.waiters.slice().forEach((w) => w());
    } else if (f.type === T.ERR) {
      log(`❌ ERR: ${f.payload.m}`);
      process.exit(5);
    }
  }
});

async function run() {
  // 1. 监控器列表
  const nets = await request('networks');
  log(`[4] networks → ${nets.ok ? 'ok' : 'fail ' + nets.m}`);
  if (!nets.ok) {
    log('    （token 已通过鉴权，但服务端还没加载到监控器：区块未加载时会出现这个）');
    finish(0);
    return;
  }
  const monitors = nets.b ?? [];
  log(`    共 ${monitors.length} 个监控器：`);
  monitors.forEach((m) => log(`      DIM ${m.dimid}  (${m.x}, ${m.y}, ${m.z})`));
  if (monitors.length === 0) {
    finish(0);
    return;
  }
  // 逐个试，跳过服务端已经不存在的坐标（登记表可能有陈旧记录）
  let target = null;
  let itemsStream = null;
  let full = null;
  for (const m of monitors) {
    const s = await subscribe('items', { ...m, craftableOnly: false });
    const f = await waitFrame(s, 0);
    if (f.t === 'e') {
      log(`[5] DIM ${m.dimid} (${m.x}, ${m.y}, ${m.z}) → ${f.m}`);
      send(T.UNSUB, { s: s.id });
      continue;
    }
    target = m;
    itemsStream = s;
    full = f;
    break;
  }
  if (!target) {
    log('❌ 所有监控器都不可用');
    finish(0);
    return;
  }
  log(`[5] 订阅 items @ DIM ${target.dimid} (${target.x}, ${target.y}, ${target.z})，sid=${itemsStream.sid}`);
  log(`    全量帧 t=${full.t} 条目 ${full.d.length} 条，${kb(JSON.stringify(full).length)}（seq=${full.seq}）`);
  const samples = full.d.slice(0, 3).map((r) => `${r[0]}:${r[1]} × ${r[2]}`);
  log(`    样例：${samples.join(' / ')}`);

  // 3. CPU 列表
  const cpus = await request('cpusOnce', target);
  log(`[6] cpusOnce → ${cpus.ok ? `${cpus.b.length} 台 CPU` : 'fail ' + cpus.m}`);
  if (cpus.ok && cpus.b.length) {
    cpus.b.slice(0, 5).forEach((c) =>
      log(`      #${c.idx} ${c.cpuName}  容量 ${c.storage}  并行 ${c.parallelism}  ${c.item ? '运行中: ' + c.item + ' 剩余 ' + c.remainingCount : '空闲'}`),
    );
  }

  // 4. 运行中任务的明细（挑第一台忙的）
  const busy = (cpus.b ?? []).find((c) => c.item);
  if (busy) {
    const dStream = await subscribe('details', { ...target, cpuid: busy.idx });
    const dFull = await waitFrame(dStream, 0);
    if (dFull.t === 'f') {
      log(`[7] 订阅 details(#${busy.idx}) → ${dFull.d.length} 条任务，${kb(JSON.stringify(dFull).length)}`);
      dFull.d.slice(0, 3).forEach((r) => log(`      ${r[0]}:${r[1]}  已发 ${r[3]} / 剩余 ${r[4]}`));
    } else {
      log(`[7] details 返回 ${dFull.t} ${dFull.m ?? ''}`);
    }
    send(T.UNSUB, { s: dStream.id });
  } else {
    log('[7] 没有运行中的 CPU，跳过 details');
  }

  // 4.5 生成合成计划（挑一个 craftable 的物品，数量 1）
  const craftable = full.d.find((r) => r[3] === true);
  if (craftable) {
    log(`[8] 生成合成计划：${craftable[0]}:${craftable[1]} × 1`);
    const t0 = Date.now();
    let rounds = 0;
    try {
      const plan = await request(
        'plan',
        { ...target, item: craftable[0], meta: craftable[1], nbt: '', count: 1 },
        () => {
          rounds++;
        },
      );
      const ms = Date.now() - t0;
      if (!plan.ok) {
        log(`    ❌ 计划失败：${plan.m}`);
      } else if (!plan.b || !Array.isArray(plan.b.plan)) {
        log(`    ❌ 返回体不是计划对象：${JSON.stringify(plan.b).slice(0, 120)}`);
      } else {
        log(`    ✅ 计划 ${plan.b.plan.length} 步 / ${plan.b.bytesUsed} 字节，${rounds} 条进度，耗时 ${ms}ms`);
        plan.b.plan.slice(0, 3).forEach((t) => log(`      ${t.name}:${t.meta} × ${t.numberRemainingToCraft}`));
      }
    } catch (e) {
      log(`    ❌ 计划请求异常：${e.message}`);
    }
  } else {
    log('[8] 没有 craftable 物品，跳过计划测试');
  }

  // 5. 等一帧增量，确认 diff 在真实数据上工作
  log('[8] 等 items 增量帧（真服务器 600s 一推，这里最多等 8 秒，等不到不算失败）');
  const before = itemsStream.frames.length;
  const got = await Promise.race([
    waitFrame(itemsStream, before).then((f) => f),
    new Promise((r) => setTimeout(() => r(null), 8000)),
  ]);
  if (got) log(`    收到 t=${got.t} ${kb(JSON.stringify(got).length)}`);
  else log('    8 秒内没有新帧（正常，items 间隔 600s）');

  finish(0);
}

function finish(code) {
  clearTimeout(hardTimeout);
  socket.destroy();
  log(code === 0 ? '\n✅ 真服务器验证结束' : '\n❌ 中止');
  process.exit(code);
}
