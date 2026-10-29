// AEMobile mod 的本地 mock 服务端（开发/UI 联调用，零依赖）。
//
// 用法：node mock/server.mjs [端口，默认 44444] [--debug]
//
// 协议 3.0.0（裸 TCP）：
//   帧格式 [len:4B][type:1B][flags:1B][payload: JSON]
//   HELLO → HELLO_ACK（带 nonce 和服务器时间）→ AUTH（HMAC 签名）→ AUTH_OK
//   之后 REQ/RES 一次性请求，SUB/SUB_OK/PUSH 订阅推送
//
// 帧内容（全量 / 增量 / 心跳）和 2.1.0 的 SSE 完全一样，
// 所以 App 的 frames.ts 累加器不用改。
//
// 模拟器内访问宿主机：MuMu 用 10.0.2.2。
import net from "node:net";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) || 44444);
const DEBUG = process.argv.includes("--debug");

/** App 里要填的访问密码（26 字符 Base32） */
const TOKEN = "MOCKTOKEN234567ABCDEFGHJKLM";
const KID = TOKEN.slice(0, 8);
const MAX_SKEW = 600;

const T = {
  HELLO: 0x01,
  HELLO_ACK: 0x02,
  AUTH: 0x03,
  AUTH_OK: 0x04,
  AUTH_FAIL: 0x05,
  REQ: 0x10,
  RES: 0x11,
  SUB: 0x20,
  SUB_OK: 0x21,
  PUSH: 0x22,
  UNSUB: 0x23,
  PING: 0x30,
  PONG: 0x31,
  ERR: 0x40,
};

const { items, nbt_items, fluids } = JSON.parse(readFileSync(join(__dirname, "data.json"), "utf-8"));

// ---------------------------------------------------------------- 帧编解码

function encode(type, payload) {
  const body = payload === undefined || payload === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(payload), "utf8");
  const out = Buffer.allocUnsafe(6 + body.length);
  out.writeInt32BE(2 + body.length, 0);
  out.writeUInt8(type, 4);
  out.writeUInt8(0, 5);
  body.copy(out, 6);
  return out;
}

// ---------------------------------------------------------------- 假数据

function randCount() {
  const r = Math.random();
  if (r < 0.5) return Math.floor(Math.random() * 64);
  if (r < 0.8) return Math.floor(Math.random() * 100000);
  if (r < 0.95) return Math.floor(Math.random() * 100000000);
  return Math.floor(Math.random() * 1000000000000);
}

const storedItems = items.map((it) => ({
  item_name: it.name,
  count: randCount(),
  craftable: Math.random() < 0.55,
  meta: it.meta,
  nbt: null,
}));
nbt_items.forEach((it, i) => {
  if (i % 3 === 0 || it.nbt) {
    const demoNbt =
      Buffer.from([0x0a, 0x00, 0x00, 0x08, 0x00, 0x04]).toString("base64") +
      Buffer.from("demo").toString("base64") +
      Buffer.from([0]).toString("base64");
    storedItems.push({
      item_name: it.name,
      count: randCount(),
      craftable: Math.random() < 0.5,
      meta: it.meta,
      nbt: it.nbt || demoNbt, // 数据里自带 nbt（源质等）就用自带的
    });
  }
});
fluids.forEach((f, i) => {
  if (i % 2 === 0) {
    storedItems.push({
      item_name: "ae2fc:fluid_drop",
      count: f.amount * (1 + Math.floor(Math.random() * 50)),
      craftable: Math.random() < 0.3,
      meta: 0,
      nbt: f.nbt,
    });
  }
});

const cpus = [
  { idx: 0, cpuName: "装配主环", storage: 16 * 1024 * 1024, parallelism: 1024, item: null, remainingCount: 0, meta: 0, nbt: null },
  { idx: 1, cpuName: "并行阵线A", storage: 4 * 1024 * 1024, parallelism: 256, item: null, remainingCount: 0, meta: 0, nbt: null },
  { idx: 2, cpuName: "并行阵线B", storage: 4 * 1024 * 1024, parallelism: 256, item: null, remainingCount: 0, meta: 0, nbt: null },
  { idx: 3, cpuName: "大工程专用", storage: 64 * 1024 * 1024, parallelism: 4096, item: null, remainingCount: 0, meta: 0, nbt: null },
  { idx: 4, cpuName: "小型合成", storage: 1 * 1024 * 1024, parallelism: 64, item: null, remainingCount: 0, meta: 0, nbt: null },
  { idx: 5, cpuName: "备用", storage: 2 * 1024 * 1024, parallelism: 128, item: null, remainingCount: 0, meta: 0, nbt: null },
];

function makePlan(count) {
  const plan = [];
  const n = 6 + Math.floor(Math.random() * 10);
  for (let i = 0; i < n; i++) {
    const it = items[Math.floor(Math.random() * items.length)];
    const missing = Math.random() < 0.15 ? Math.ceil(Math.random() * 32) : 0;
    plan.push({
      name: it.name,
      meta: it.meta,
      nbt: null,
      crafting: Math.random() < 0.6,
      numberPresent: Math.floor(Math.random() * 5000),
      numberSent: 0,
      numberRemainingToCraft: Math.ceil((count / n) * (0.5 + Math.random())),
      missing,
    });
  }
  return { plan, bytesUsed: 1024 * 1024 * (1 + Math.floor(Math.random() * 8)) };
}

const runningJobs = new Map();
[0, 3].forEach((idx) => {
  const job = makePlan(4096).plan.map((t) => ({
    ...t,
    numberSent: Math.floor(t.numberRemainingToCraft * (0.2 + Math.random() * 0.6)),
    numberRemainingToCraft: Math.floor(t.numberRemainingToCraft * 0.3),
  }));
  runningJobs.set(idx, job);
  const cpu = cpus.find((c) => c.idx === idx);
  cpu.item = job[0].name;
  cpu.meta = job[0].meta;
  cpu.remainingCount = job.reduce((s, t) => s + t.numberRemainingToCraft, 0);
});

// ---------------------------------------------------------------- 增量帧

/** sid → 增量状态（断线续传用，和真服务端 StreamState 一个意思） */
const sessions = new Map();

function acquireSession(sid) {
  if (sid && sessions.has(sid)) return sessions.get(sid);
  const fresh = {
    sid: crypto.randomBytes(6).toString("hex"),
    seq: 0,
    fullSent: false,
    items: new Map(),
    cpus: new Map(),
    tasks: new Map(),
  };
  sessions.set(fresh.sid, fresh);
  if (sessions.size > 32) sessions.delete(sessions.keys().next().value);
  return fresh;
}

function itemsFrame(st) {
  const current = new Map();
  // 必须存值拷贝：直接存对象引用的话，下一轮 mutate 会把「上一帧」一起改掉，
  // 增量永远判定为「无变化」，只会发心跳。
  for (const it of storedItems)
    current.set(`${it.item_name}|${it.meta}`, { name: it.item_name, meta: it.meta, count: it.count, craftable: it.craftable, nbt: it.nbt });

  const frame = {};
  if (!st.fullSent) {
    frame.t = "f";
    frame.sid = st.sid;
    frame.seq = ++st.seq;
    frame.d = storedItems.map((it) => [it.item_name, it.meta, it.count, it.craftable]);
    const nbt = {};
    storedItems.forEach((it, i) => {
      if (it.nbt) nbt[String(i)] = it.nbt;
    });
    if (Object.keys(nbt).length) frame.n = nbt;
    st.fullSent = true;
  } else {
    const c = [];
    const a = [];
    const x = [];
    for (const [k, it] of current) {
      const prev = st.items.get(k);
      if (!prev) a.push([it.name, it.meta, it.count, it.craftable, it.nbt]);
      else if (prev.count !== it.count || prev.craftable !== it.craftable) c.push([it.name, it.meta, it.count, it.craftable]);
    }
    for (const k of st.items.keys()) {
      if (!current.has(k)) {
        const [n, m] = [k.slice(0, k.lastIndexOf("|")), Number(k.slice(k.lastIndexOf("|") + 1))];
        x.push([n, m]);
      }
    }
    if (!c.length && !a.length && !x.length) {
      frame.t = "k";
      frame.seq = ++st.seq;
    } else {
      frame.t = "d";
      frame.sid = st.sid;
      frame.seq = ++st.seq;
      if (c.length) frame.c = c;
      if (a.length) frame.a = a;
      if (x.length) frame.x = x;
    }
  }
  st.items = current;
  return frame;
}

function cpusFrame(st) {
  const sig = (c) => `${c.remainingCount}|${c.item}|${c.meta}`;
  const current = new Map(cpus.map((c) => [c.idx, sig(c)]));
  const frame = {};
  if (!st.fullSent) {
    frame.t = "f";
    frame.sid = st.sid;
    frame.seq = ++st.seq;
    frame.d = cpus.map((c) => [c.idx, c.cpuName, c.storage, c.parallelism, c.item, c.meta, c.remainingCount]);
    st.fullSent = true;
  } else {
    const c = [];
    for (const cpu of cpus) {
      if (st.cpus.get(cpu.idx) !== sig(cpu)) c.push([cpu.idx, cpu.remainingCount, cpu.item, cpu.meta]);
    }
    const x = [...st.cpus.keys()].filter((idx) => !current.has(idx));
    if (!c.length && !x.length) {
      frame.t = "k";
      frame.seq = ++st.seq;
    } else {
      frame.t = "d";
      frame.sid = st.sid;
      frame.seq = ++st.seq;
      if (c.length) frame.c = c;
      if (x.length) frame.x = x;
    }
  }
  st.cpus = current;
  return frame;
}

function tasksFrame(st, job) {
  const current = new Map(
    job.map((t) => [`${t.name}|${t.meta}`, { numberSent: t.numberSent, numberRemainingToCraft: t.numberRemainingToCraft }]),
  );
  const frame = {};
  if (!st.fullSent) {
    frame.t = "f";
    frame.sid = st.sid;
    frame.seq = ++st.seq;
    frame.d = job.map((t) => [t.name, t.meta, t.numberPresent, t.numberSent, t.numberRemainingToCraft, t.crafting, t.missing]);
    st.fullSent = true;
  } else {
    const c = [];
    for (const t of job) {
      const prev = st.tasks.get(`${t.name}|${t.meta}`);
      if (!prev || prev.numberSent !== t.numberSent || prev.numberRemainingToCraft !== t.numberRemainingToCraft)
        c.push([t.name, t.meta, t.numberSent, t.numberRemainingToCraft]);
    }
    const x = [...st.tasks.keys()]
      .filter((k) => !current.has(k))
      .map((k) => [k.slice(0, k.lastIndexOf("|")), Number(k.slice(k.lastIndexOf("|") + 1))]);
    if (!c.length && !x.length) {
      frame.t = "k";
      frame.seq = ++st.seq;
    } else {
      frame.t = "d";
      frame.sid = st.sid;
      frame.seq = ++st.seq;
      if (c.length) frame.c = c;
      if (x.length) frame.x = x;
    }
  }
  st.tasks = current;
  return frame;
}

// 每次推 items 之前改几条数量，让增量帧有内容
function mutateItems() {
  for (let i = 0; i < 8; i++) {
    const it = storedItems[Math.floor(Math.random() * storedItems.length)];
    it.count = Math.max(0, it.count + Math.floor(Math.random() * 200) - 80);
  }
}

function advanceJobs() {
  for (const [idx, job] of runningJobs) {
    let remaining = 0;
    job.forEach((t) => {
      if (t.numberRemainingToCraft > 0) {
        const step = Math.max(1, Math.ceil(t.numberRemainingToCraft * 0.02));
        t.numberRemainingToCraft = Math.max(0, t.numberRemainingToCraft - step);
        t.numberSent += step;
      }
      remaining += t.numberRemainingToCraft;
    });
    const cpu = cpus.find((c) => c.idx === idx);
    if (cpu) cpu.remainingCount = remaining;
    if (remaining <= 0) {
      runningJobs.delete(idx);
      if (cpu) {
        cpu.item = null;
        cpu.remainingCount = 0;
      }
    }
  }
}

// ---------------------------------------------------------------- 连接

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const STREAM_INTERVAL = { items: 30000, cpus: 5000, details: 2000 };

function createConn(socket) {
  const peer = `${socket.remoteAddress}:${socket.remotePort}`;
  const conn = {
    socket,
    authed: false,
    nonce: null,
    subs: new Map(), // streamId → { op, params, st, timer }
    nextStream: 0,
    planTimers: new Set(),
  };

  const send = (type, payload) => {
    if (socket.destroyed) return;
    socket.write(encode(type, payload));
  };

  const res = (id, ok, body, message, more) => {
    const m = { id, ok, b: body };
    if (message) m.m = message;
    if (more) m.more = true;
    send(T.RES, m);
  };

  const stopSub = (streamId) => {
    const sub = conn.subs.get(streamId);
    if (!sub) return;
    if (sub.timer) clearInterval(sub.timer);
    conn.subs.delete(streamId);
  };

  const pushOnce = (streamId, sub) => {
    if (socket.destroyed) return;
    let frame;
    if (sub.op === "items") {
      mutateItems();
      frame = itemsFrame(sub.st);
    } else if (sub.op === "cpus") {
      advanceJobs();
      frame = cpusFrame(sub.st);
    } else if (sub.op === "details") {
      const job = runningJobs.get(sub.params.cpuid);
      if (!job) {
        frame = { t: "e", m: "该 CPU 没有正在运行的任务" };
      } else {
        job.forEach((t) => {
          if (t.numberRemainingToCraft > 0 && Math.random() < 0.5) {
            t.numberRemainingToCraft -= Math.ceil(t.numberRemainingToCraft * 0.02) + 1;
            t.numberSent += 1;
          }
        });
        frame = tasksFrame(sub.st, job);
      }
    } else {
      frame = { t: "e", m: `UNKNOWN_STREAM:${sub.op}` };
    }
    send(T.PUSH, { s: streamId, f: frame });
  };

  // ---- 请求 ----

  function handleReq(root) {
    const id = Number(root?.id ?? 0);
    const op = String(root?.op ?? "");
    const p = root?.p ?? {};
    if (!conn.authed) return res(id, false, null, "AUTH_REQUIRED", false);

    switch (op) {
      case "networks":
        return res(id, true, [{ dimid: 0, x: 1024, y: 64, z: -512 }]);
      case "mspt":
        // mod 侧没有这个功能，App 会显示「监控插件未启用」
        return res(id, false, null, "NOT_SUPPORTED", false);
      case "itemsOnce":
        return res(id, true, storedItems.map((it) => ({ ...it })));
      case "cpusOnce":
        return res(id, true, cpus);
      case "detailsOnce": {
        const job = runningJobs.get(Number(p.cpuid));
        if (!job) return res(id, false, null, "该 CPU 没有正在运行的任务", false);
        return res(id, true, job);
      }
      case "cancel": {
        const cpuId = Number(p.cpuid);
        runningJobs.delete(cpuId);
        const cpu = cpus.find((c) => c.idx === cpuId);
        if (cpu) {
          cpu.item = null;
          cpu.remainingCount = 0;
        }
        return res(id, true, "Success", null, false);
      }
      case "start": {
        const cpuId = Number(p.cpuId);
        const cpu = cpus.find((c) => c.idx === cpuId);
        if (!cpu || cpu.item != null) return res(id, false, null, "所选 CPU 不可用或正忙", false);
        cpu.item = p.item;
        cpu.meta = Number(p.meta || 0);
        cpu.remainingCount = Number(p.count || 100);
        runningJobs.set(cpuId, makePlan(cpu.remainingCount).plan.map((t) => ({ ...t, numberSent: 0 })));
        return res(id, true, "Success", null, false);
      }
      case "plan": {
        const count = Number(p.count || 1);
        let resolved = 3;
        const step = () => {
          if (socket.destroyed) return;
          if (resolved > 24) {
            res(id, true, makePlan(count), null, false);
            return;
          }
          res(id, true, `SIMULATING - resolved: ${resolved}`, null, true);
          resolved += 3 + Math.floor(Math.random() * 4);
          const t = setTimeout(step, 350);
          conn.planTimers.add(t);
        };
        step();
        return undefined;
      }
      default:
        return res(id, false, null, `UNKNOWN_OP:${op}`, false);
    }
  }

  // ---- 订阅 ----

  function handleSub(root) {
    const id = Number(root?.id ?? 0);
    const op = String(root?.op ?? "");
    const p = root?.p ?? {};
    if (!conn.authed) return res(id, false, null, "AUTH_REQUIRED", false);
    if (!STREAM_INTERVAL[op]) return res(id, false, null, `UNKNOWN_STREAM:${op}`, false);

    const st = acquireSession(p.sid);
    const streamId = ++conn.nextStream;
    const sub = { op, params: p, st, timer: null };
    conn.subs.set(streamId, sub);
    send(T.SUB_OK, { id, s: streamId, sid: st.sid });
    pushOnce(streamId, sub);
    sub.timer = setInterval(() => pushOnce(streamId, sub), STREAM_INTERVAL[op]);
    return undefined;
  }

  // ---- 鉴权 ----

  function handleAuth(root) {
    if (conn.authed) return send(T.AUTH_OK, null);
    if (!conn.nonce) return send(T.ERR, { m: "HELLO_REQUIRED" });
    const kid = String(root?.kid ?? "");
    const ts = Number(root?.ts ?? 0);
    const sig = String(root?.sig ?? "");
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > MAX_SKEW) return send(T.AUTH_FAIL, { code: "CLOCK", time: now });
    if (kid !== KID) return send(T.AUTH_FAIL, { code: "AUTH_FAILED" });
    const canonical = `AE2TCP\n${ts}\n${conn.nonce}`;
    const expect = b64url(crypto.createHmac("sha256", TOKEN).update(canonical).digest());
    if (expect !== sig) {
      if (DEBUG) console.log("[auth] 签名不匹配", { canonical, expect, sig });
      return send(T.AUTH_FAIL, { code: "AUTH_FAILED" });
    }
    conn.authed = true;
    send(T.AUTH_OK, null);
    console.log(`[mock] ${peer} 鉴权通过`);
  }

  // ---- 拆包 ----

  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 4) return;
      const len = buf.readInt32BE(0);
      if (len < 2 || len > 4 * 1024 * 1024) {
        socket.destroy();
        return;
      }
      if (buf.length < 4 + len) return;
      const type = buf.readUInt8(4);
      const text = buf.subarray(6, 4 + len).toString("utf8");
      buf = buf.subarray(4 + len);
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
      if (DEBUG) console.log("[recv]", type.toString(16), text.slice(0, 200));

      switch (type) {
        case T.HELLO: {
          if (Number(payload?.v) !== 3) {
            send(T.ERR, { m: `VERSION_MISMATCH:server=3` });
            socket.destroy();
            break;
          }
          conn.nonce = b64url(crypto.randomBytes(8));
          send(T.HELLO_ACK, {
            v: 3,
            name: "AEMobile",
            ver: "mock-3.0.0",
            time: Math.floor(Date.now() / 1000),
            nonce: conn.nonce,
          });
          break;
        }
        case T.AUTH:
          handleAuth(payload);
          break;
        case T.REQ:
          handleReq(payload);
          break;
        case T.SUB:
          handleSub(payload);
          break;
        case T.UNSUB:
          stopSub(Number(payload?.s ?? -1));
          break;
        case T.PING:
          send(T.PONG, null);
          break;
        default:
          break;
      }
    }
  });

  const cleanup = () => {
    for (const sub of conn.subs.values()) if (sub.timer) clearInterval(sub.timer);
    conn.subs.clear();
    for (const t of conn.planTimers) clearTimeout(t);
    conn.planTimers.clear();
    console.log(`[mock] ${peer} 断开`);
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
  console.log(`[mock] ${peer} 连接`);
}

net.createServer(createConn).listen(PORT, () => {
  console.log(`[mock] AEMobile 协议 3.0.0 (TCP) mock on 127.0.0.1:${PORT}`);
  console.log(`[mock] 访问密码(token): ${TOKEN}`);
  console.log(`[mock] 物品 ${storedItems.length} 条 / CPU ${cpus.length} 台（0、3 号在跑）`);
});
