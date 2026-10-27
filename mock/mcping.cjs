// 探测 Minecraft 代理/服务端：发一个 1.7.10 的登录握手，把对端的断开原因读出来。
//
// 用法：node mock/mcping.cjs <host> <port> [协议版本] [玩家名]
//   nextState=1 是服务器列表 ping；这里用 2（登录），能拿到真实的 kick 原因 JSON。
const net = require('node:net');

const host = process.argv[2] || '127.0.0.1';
const port = Number(process.argv[3] || 25565);
const proto = Number(process.argv[4] || 5); // 1.7.10 = 5
const name = process.argv[5] || 'ProbeBot';

function varint(n) {
  const out = [];
  for (;;) {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
    if (n === 0) break;
  }
  return Buffer.from(out);
}

function str(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(b.length), b]);
}

function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}

class Reader {
  constructor(buf) {
    this.b = buf;
    this.i = 0;
  }
  varint() {
    let n = 0,
      shift = 0;
    for (;;) {
      const b = this.b[this.i++];
      n |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return n;
  }
  str() {
    const len = this.varint();
    const s = this.b.slice(this.i, this.i + len).toString('utf8');
    this.i += len;
    return s;
  }
  rest() {
    return this.b.slice(this.i);
  }
}

const socket = net.createConnection({ host, port });
let buf = Buffer.alloc(0);
const t0 = Date.now();

const timer = setTimeout(() => {
  console.log(`❌ ${Date.now() - t0}ms 内没有任何回应（TCP 通但应用层不理人）`);
  process.exit(2);
}, 8000);

socket.on('connect', () => {
  console.log(`[1] TCP 连上 ${host}:${port}（${Date.now() - t0}ms）`);
  const handshake = packet(
    0x00,
    Buffer.concat([varint(proto), str(host), Buffer.from([port >> 8, port & 0xff]), varint(2)]),
  );
  const login = packet(0x00, str(name));
  socket.write(Buffer.concat([handshake, login]));
  console.log(`[2] 已发送 handshake(proto=${proto}, nextState=2) + login("${name}")`);
});

socket.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    // 读长度前缀
    let len = 0,
      shift = 0,
      i = 0,
      done = false;
    while (i < buf.length) {
      const b = buf[i++];
      len |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) {
        done = true;
        break;
      }
      shift += 7;
    }
    if (!done || buf.length < i + len) return;
    const body = buf.slice(i, i + len);
    buf = buf.slice(i + len);

    const r = new Reader(body);
    const id = r.varint();
    if (id === 0x00) {
      const json = r.str();
      let reason = json;
      try {
        reason = JSON.parse(json);
      } catch {}
      console.log(`[3] ❌ 被断开（Disconnect 0x00）：`);
      console.log('    ', typeof reason === 'string' ? reason : JSON.stringify(reason));
      clearTimeout(timer);
      socket.destroy();
      process.exit(3);
    } else if (id === 0x02) {
      console.log(`[3] ✅ 登录成功（Login Success）—— 说明代理和后台都正常，问题在客户端侧`);
      clearTimeout(timer);
      socket.destroy();
      process.exit(0);
    } else if (id === 0x03) {
      console.log(`[3] 收到 Set Compression`);
    } else if (id === 0x01) {
      console.log(`[3] 收到 Encrypt Request（代理在要求正版验证）`);
      clearTimeout(timer);
      socket.destroy();
      process.exit(4);
    } else {
      console.log(`[3] 收到未知包 id=0x${id.toString(16)} len=${len}`);
    }
  }
});

socket.on('error', (e) => {
  clearTimeout(timer);
  console.log(`❌ 连接错误：${e.code || e.message}`);
  process.exit(2);
});
