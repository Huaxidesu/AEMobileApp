// 连接诊断：逐层确认「TCP 通不通 → 协议对不对 → 密码对不对」。
//
// 用法：
//   node mock/probe.cjs <host> [port] [token]
//
// 三层检查：
//   1. TCP 能否建立（3 秒超时）
//   2. 发 HELLO 能否收到 HELLO_ACK（说明对端是 3.0.0 的 mod，而不是旧版 Tomcat/别的服务）
//   3. 给了 token 就再试 AUTH，看签名是否通过
//
// 需要先把协议模块编译到 mock/gen（见 doc/传输协议与安全.md §11）。
const net = require('node:net');
const { encodeFrame, FrameDecoder, T, PROTOCOL_VERSION } = require('./gen/net/protocol.js');
const { tcpAuth, setClockOffset } = require('./gen/auth.js');

const host = process.argv[2];
const port = Number(process.argv[3] || 44444);
const token = process.argv[4] || '';

if (!host) {
  console.log('用法: node mock/probe.cjs <host> [port] [token]');
  process.exit(1);
}

const log = (...a) => console.log(...a);
const t0 = Date.now();

log(`[1/3] 连接 ${host}:${port} …`);
const socket = net.createConnection({ host, port });

const decoder = new FrameDecoder();
let step = 1;
let gotHelloAck = false;

const timer = setTimeout(() => {
  log(`\n❌ 超时（${Date.now() - t0}ms）——${step === 1 ? 'TCP 连不上（端口没开 / 防火墙 / IP 不对）' : 'TCP 通了但没收到 HELLO_ACK（对端不是 3.0.0 的 mod？）'}`);
  socket.destroy();
  process.exit(2);
}, 8000);

socket.on('connect', () => {
  log(`  ✅ TCP 已建立（${Date.now() - t0}ms）`);
  step = 2;
  log('[2/3] 发 HELLO，等 HELLO_ACK …');
  socket.write(encodeFrame(T.HELLO, { v: PROTOCOL_VERSION, app: 'probe/1.0' }));
});

socket.on('data', (chunk) => {
  let frames;
  try {
    frames = decoder.push(chunk);
  } catch (e) {
    log(`\n❌ 收到无法解析的数据：${e.message}`);
    log('   对端可能不是 3.0.0 的 mod（比如旧版 HTTP/Tomcat，或者端口被别的服务占了）');
    socket.destroy();
    process.exit(3);
  }
  for (const f of frames) {
    if (f.type === T.HELLO_ACK) {
      gotHelloAck = true;
      log(`  ✅ HELLO_ACK: v=${f.payload.v} name=${f.payload.name} ver=${f.payload.ver}`);
      log(`     服务器时间 ${f.payload.time}（本机偏差 ${f.payload.time - Math.floor(Date.now() / 1000)} 秒）`);
      setClockOffset(f.payload.time - Date.now() / 1000);

      if (!token) {
        log('\n[3/3] 没给 token，跳过鉴权。');
        log('\n结论：TCP 与协议层都正常。连不上的话问题在密码 / App 侧。');
        finish(0);
        return;
      }
      log('[3/3] 用给定 token 试鉴权 …');
      const ts = Math.floor(Date.now() / 1000) + Math.round(f.payload.time - Date.now() / 1000);
      const { kid, sig } = tcpAuth(token, ts, f.payload.nonce);
      socket.write(encodeFrame(T.AUTH, { kid, ts, sig }));
    } else if (f.type === T.AUTH_OK) {
      log('  ✅ AUTH_OK —— 密码正确，签名对上了');
      log('\n结论：服务端完全正常，问题在 App 侧（版本 / 地址填错 / 网络）。');
      finish(0);
    } else if (f.type === T.AUTH_FAIL) {
      log(`  ❌ AUTH_FAIL code=${f.payload.code}`);
      if (f.payload.code === 'CLOCK') log('     → 手机/本机时钟偏差太大，重签一次即可');
      if (f.payload.code === 'AUTH_FAILED') log('     → 密码不对（或服务端还没注册这个 token：先站到监控器旁边让它加载一次）');
      if (f.payload.code === 'BANNED') log('     → 这个 IP 失败次数太多被临时封了，等 60 秒');
      finish(4);
    } else if (f.type === T.ERR) {
      log(`  ❌ ERR: ${f.payload.m}`);
      finish(5);
    }
  }
});

socket.on('error', (e) => {
  clearTimeout(timer);
  log(`\n❌ ${step === 1 ? 'TCP 连接失败' : '连接中断'}：${e.code || e.message}`);
  if (e.code === 'ECONNREFUSED') log('   → 端口没有监听：mod 没起来 / 端口配错 / 服务器没重启');
  if (e.code === 'ETIMEDOUT' || e.code === 'EHOSTUNREACH') log('   → 被防火墙或安全组挡了（要放行 TCP 这个端口）');
  if (e.code === 'ENOTFOUND') log('   → 域名解析失败');
  process.exit(2);
});

socket.on('close', () => {
  if (!gotHelloAck && step === 2) {
    log('\n❌ 连接被对端关闭，没收到 HELLO_ACK');
    log('   → 对端可能是旧版（HTTP/Tomcat）：它收到二进制帧会直接 400 关连接');
    process.exit(3);
  }
});

function finish(code) {
  clearTimeout(timer);
  socket.destroy();
  process.exit(code);
}
