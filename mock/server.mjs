// AEMobile mod 接口的本地 mock 服务器（开发/UI 测试用，零依赖）。
// 用法：node mock/server.mjs  [端口默认 44444]
// 模拟器内通过 `adb reverse tcp:44444 tcp:44444` 访问 http://127.0.0.1:44444。
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 44444);
const { items, nbt_items, fluids } = JSON.parse(readFileSync(join(__dirname, "data.json"), "utf-8"));

const ok = (body) => JSON.stringify({ succeed: true, body, message: "" });
const err = (msg) => JSON.stringify({ succeed: false, message: msg });

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randCount() {
  const r = Math.random();
  if (r < 0.5) return Math.floor(Math.random() * 64);
  if (r < 0.8) return Math.floor(Math.random() * 100000);
  if (r < 0.95) return Math.floor(Math.random() * 100000000);
  return Math.floor(Math.random() * 1000000000000);
}

// ---- 物品列表（getItems 的 body）----
const storedItems = items.map((it) => ({
  item_name: it.name,
  count: randCount(),
  craftable: Math.random() < 0.55,
  meta: it.meta,
}));
nbt_items.forEach((it, i) => {
  if (i % 3 === 0)
    storedItems.push({
      item_name: it.name,
      count: randCount(),
      craftable: Math.random() < 0.5,
      meta: it.meta,
      nbt: Buffer.from([0x0a, 0x00, 0x00, 0x08, 0x00, 0x04]).toString("base64") + Buffer.from("demo").toString("base64") + Buffer.from([0]).toString("base64"),
    });
});
fluids.forEach((f, i) => {
  if (i % 2 === 0)
    storedItems.push({
      item_name: "ae2fc:fluid_drop",
      count: f.amount * (1 + Math.floor(Math.random() * 50)),
      craftable: Math.random() < 0.3,
      meta: 0,
      nbt: f.nbt,
    });
});

// ---- 合成 CPU ----
const cpus = [
  { idx: 0, cpuName: "装配主环", storage: 16 * 1024 * 1024, parallelism: 1024, item: null, remainingCount: 0, meta: 0, nbt: null, icon: null, displayname: null },
  { idx: 1, cpuName: "并行阵线A", storage: 4 * 1024 * 1024, parallelism: 256, item: null, remainingCount: 0, meta: 0, nbt: null, icon: null, displayname: null },
  { idx: 2, cpuName: "并行阵线B", storage: 4 * 1024 * 1024, parallelism: 256, item: null, remainingCount: 0, meta: 0, nbt: null, icon: null, displayname: null },
  { idx: 3, cpuName: "大工程专用", storage: 64 * 1024 * 1024, parallelism: 4096, item: null, remainingCount: 0, meta: 0, nbt: null, icon: null, displayname: null },
  { idx: 4, cpuName: "小任务队列", storage: 1024 * 1024, parallelism: 64, item: null, remainingCount: 0, meta: 0, nbt: null, icon: null, displayname: null },
  { idx: 5, cpuName: "应急通道", storage: 512 * 1024, parallelism: 16, item: null, remainingCount: 0, meta: 0, nbt: null, icon: null, displayname: null },
];
function busyify(cpu) {
  const it = pick(storedItems.filter((s) => s.craftable));
  cpu.item = it.item_name;
  cpu.meta = it.meta;
  cpu.remainingCount = 500 + Math.floor(Math.random() * 20000);
}
busyify(cpus[0]);
busyify(cpus[3]);

function makePlan(count) {
  const size = 24 + Math.floor(Math.random() * 40);
  const plan = [];
  const used = new Set();
  for (let i = 0; i < size; i++) {
    const src = pick(storedItems);
    const key = src.item_name + ":" + src.meta;
    if (used.has(key)) continue;
    used.add(key);
    const missing = Math.random() < 0.18 ? Math.floor(1 + Math.random() * 64) : 0;
    const remaining = missing > 0 ? Math.floor(Math.random() * count * 0.2) + 1 : Math.floor(Math.random() * count * 0.8) + 1;
    plan.push({
      name: src.item_name,
      meta: src.meta,
      nbt: src.nbt ?? null,
      crafting: Math.random() < 0.5,
      numberPresent: Math.random() < 0.5 ? Math.floor(Math.random() * 512) : 0,
      numberSent: 0,
      numberRemainingToCraft: remaining,
      missing,
      icon: null,
      displayname: null,
    });
  }
  plan.sort((a, b) => b.missing - a.missing);
  return { plan, bytesUsed: count * 64 + Math.floor(Math.random() * 4096) };
}
// 给两个忙碌 CPU 预置运行中的任务明细
const runningJobs = new Map();
[0, 3].forEach((idx) => {
  const job = makePlan(4096).plan.map((t) => ({
    ...t,
    numberSent: Math.floor(t.numberRemainingToCraft * (0.2 + Math.random() * 0.6)),
    numberRemainingToCraft: Math.floor(t.numberRemainingToCraft * 0.3),
  }));
  runningJobs.set(idx, job);
});

function parseUrlencoded(body) {
  const out = {};
  for (const pair of String(body || "").split("&")) {
    if (!pair) continue;
    const [k, v] = pair.split("=").map(decodeURIComponent);
    out[k] = v;
  }
  return out;
}

function sseInit(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}
function sseSend(res, data, seq, event = "message") {
  res.write(`id: ${seq}\nevent: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  let seq = 0;
  let timer = null;
  res.on("close", () => timer && clearInterval(timer));

  if (p === "/AEMobileTest") {
    res.writeHead(200).end("<h1>hello world</h1>");
    return;
  }
  if (p === "/AE2/getNetworks") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(ok([{ dimid: 0, x: 1024, y: 64, z: -512 }]));
    return;
  }

  if (p === "/AE2/getItems") {
    sseInit(res);
    const push = () => sseSend(res, ok(storedItems), seq++);
    push();
    timer = setInterval(push, 120000);
    return;
  }

  if (p === "/AE2/getCraftingCpuInfo" || p === "/AE2/getCraftingCpuInfoNoSSE") {
    if (p.endsWith("NoSSE")) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(ok(cpus));
      return;
    }
    sseInit(res);
    const push = () => sseSend(res, ok(cpus), seq++);
    push();
    timer = setInterval(push, 5000);
    return;
  }

  if (p === "/AE2/generateCraftingPlan") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const params = parseUrlencoded(body);
      const count = Number(params.count || 1);
      sseInit(res);
      let resolved = 3;
      const pushSim = () => {
        if (resolved > 24) {
          clearInterval(timer);
          sseSend(res, ok(makePlan(count)), seq++);
          res.end();
          return;
        }
        sseSend(res, ok(`SIMULATING - resolved: ${resolved}`), seq++);
        resolved += 3 + Math.floor(Math.random() * 4);
      };
      pushSim();
      timer = setInterval(pushSim, 350);
    });
    return;
  }

  if (p === "/AE2/startCraftingJob") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const params = parseUrlencoded(body);
      const cpuId = Number(params.cpuId);
      const cpu = cpus.find((c) => c.idx === cpuId);
      if (!cpu || cpu.item != null) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(err("所选 CPU 不可用或正忙"));
        return;
      }
      cpu.item = params.item;
      cpu.meta = Number(params.meta || 0);
      cpu.remainingCount = Number(params.count || 100);
      const plan = makePlan(cpu.remainingCount).plan.map((t) => ({ ...t, numberSent: 0 }));
      runningJobs.set(cpuId, plan);
      res.writeHead(200, { "Content-Type": "application/json" }).end(ok("Success"));
    });
    return;
  }

  if (p === "/AE2/getCraftingDetails") {
    sseInit(res);
    const cpuId = Number(url.searchParams.get("cpuid") || 0);
    const push = () => {
      const job = runningJobs.get(cpuId);
      if (!job) {
        sseSend(res, err("该 CPU 没有正在运行的任务"), seq++);
        return;
      }
      // 模拟进度推进
      job.forEach((t) => {
        if (t.numberRemainingToCraft > 0 && Math.random() < 0.5) {
          t.numberRemainingToCraft -= Math.ceil(t.numberRemainingToCraft * 0.02) + 1;
          t.numberSent += 1;
        }
      });
      sseSend(res, ok(job), seq++);
    };
    push();
    timer = setInterval(push, 2000);
    return;
  }

  if (p === "/AE2/cancelTask") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const params = parseUrlencoded(body);
      const cpuId = Number(params.cpuid);
      runningJobs.delete(cpuId);
      const cpu = cpus.find((c) => c.idx === cpuId);
      if (cpu) {
        cpu.item = null;
        cpu.remainingCount = 0;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(ok("Success"));
    });
    return;
  }

  if (p === "/api/serverMSPT") {
    sseInit(res);
    let t = 0;
    const push = () => {
      const m5 = 28 + Math.sin(t / 9) * 12 + Math.random() * 8;
      const m30 = m5 + 3 + Math.random() * 4;
      const m300 = m30 + 2 + Math.random() * 3;
      sseSend(res, `${m5.toFixed(2)},${m30.toFixed(2)},${m300.toFixed(2)}`, seq++);
      t++;
    };
    push();
    timer = setInterval(push, 1000);
    return;
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, () => console.log(`[mock] AEMobile mod mock server on http://127.0.0.1:${PORT}`));
