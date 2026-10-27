const net = require('node:net');
const { encodeFrame, FrameDecoder, T, PROTOCOL_VERSION } = require('./gen/net/protocol.js');
const { tcpAuth, setClockOffset } = require('./gen/auth.js');
// token 从环境变量读，别把服务器密码写进仓库：AE_TOKEN=xxx node _plan1.cjs
const TOKEN = process.env.AE_TOKEN || '';
if (!TOKEN) { console.log('缺少 AE_TOKEN 环境变量'); process.exit(1); }
const s = net.createConnection({ host: '127.0.0.1', port: 44444 });
const dec = new FrameDecoder();
let progress = 0; const t0 = Date.now();
s.on('connect', () => s.write(encodeFrame(T.HELLO, { v: PROTOCOL_VERSION, app: 'plan-test' })));
s.on('data', (c) => {
  for (const f of dec.push(c)) {
    if (f.type === T.HELLO_ACK) {
      setClockOffset(f.payload.time - Date.now() / 1000);
      const ts = Math.floor(Date.now() / 1000);
      const { kid, sig } = tcpAuth(TOKEN, ts, f.payload.nonce);
      s.write(encodeFrame(T.AUTH, { kid, ts, sig }));
    } else if (f.type === T.AUTH_OK) {
      s.write(encodeFrame(T.REQ, { id: 1, op: 'plan', p: { dimid: 180, x: -69, y: 122, z: -69, item: 'gregtech:gt.metaitem.01', meta: 2910, nbt: '', count: 64 } }));
    } else if (f.type === T.RES) {
      if (f.payload.more) { progress++; console.log('  进度:', f.payload.b); return; }
      const ms = Date.now() - t0;
      console.log(`  结果 ok=${f.payload.ok} 进度帧=${progress} 耗时=${ms}ms`);
      if (f.payload.ok) console.log('  计划步数:', f.payload.b?.plan?.length, '字节:', f.payload.b?.bytesUsed);
      else console.log('  错误:', f.payload.m);
      s.destroy(); process.exit(0);
    } else if (f.type === T.AUTH_FAIL) { console.log('  鉴权失败', f.payload); process.exit(1); }
  }
});
setTimeout(() => { console.log('超时 60s'); process.exit(2); }, 60000);
