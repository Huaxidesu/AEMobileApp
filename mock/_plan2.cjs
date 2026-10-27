// 计划复现（带参数版）：node _plan2.cjs <item> <meta> <count> [dimid x y z]
// 打印计划的每一项，标出哪些是流体（验证 populatePlan 走 IAEStackList 后流体不再炸）
const net = require('node:net');
const { encodeFrame, FrameDecoder, T, PROTOCOL_VERSION } = require('./gen/net/protocol.js');
const { tcpAuth, setClockOffset } = require('./gen/auth.js');
// token 从环境变量读，别把服务器密码写进仓库：AE_TOKEN=xxx node _plan2.cjs <item> <meta> <count>
const TOKEN = process.env.AE_TOKEN || '';
if (!TOKEN) { console.log('缺少 AE_TOKEN 环境变量'); process.exit(1); }
const item = process.argv[2] || 'gregtech:gt.metaitem.01';
const meta = Number(process.argv[3] || 2910);
const count = Number(process.argv[4] || 64);
const s = net.createConnection({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 44444) });
const dec = new FrameDecoder();
let progress = 0; const t0 = Date.now();
s.on('connect', () => s.write(encodeFrame(T.HELLO, { v: PROTOCOL_VERSION, app: 'plan-test2' })));
s.on('data', (c) => {
  for (const f of dec.push(c)) {
    if (f.type === T.HELLO_ACK) {
      setClockOffset(f.payload.time - Date.now() / 1000);
      const ts = Math.floor(Date.now() / 1000);
      const { kid, sig } = tcpAuth(TOKEN, ts, f.payload.nonce);
      s.write(encodeFrame(T.AUTH, { kid, ts, sig }));
    } else if (f.type === T.AUTH_OK) {
      s.write(encodeFrame(T.REQ, { id: 1, op: 'plan', p: { dimid: 180, x: -69, y: 122, z: -69, item, meta, nbt: '', count } }));
    } else if (f.type === T.RES) {
      if (f.payload.more) { progress++; console.log('  进度:', f.payload.b); return; }
      const ms = Date.now() - t0;
      console.log(`${item}:${meta} ×${count}`);
      console.log(`  结果 ok=${f.payload.ok} 进度帧=${progress} 耗时=${ms}ms`);
      if (f.payload.ok) {
        const plan = f.payload.b?.plan || [];
        console.log('  计划步数:', plan.length, '字节:', f.payload.b?.bytesUsed);
        let fluid = 0;
        for (const t of plan) {
          const isFluid = String(t.name || '').includes('fluid') || t.fluid === true || t.isFluid === true;
          if (isFluid) fluid++;
          console.log(`   ${isFluid ? '[流体]' : '[物品]'} ${t.name}:${t.meta} 需合成=${t.numberRemainingToCraft} 缺失=${t.missing} 已有=${t.numberPresent}`);
        }
        console.log(`  含流体条目: ${fluid}/${plan.length}`);
      } else console.log('  错误:', f.payload.m);
      s.destroy(); process.exit(0);
    } else if (f.type === T.AUTH_FAIL) { console.log('  鉴权失败', f.payload); process.exit(1); }
  }
});
setTimeout(() => { console.log('超时 60s'); process.exit(2); }, 60000);
