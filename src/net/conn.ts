// TCP 连接管理器（单例）。
//
// 一条 TCP 连接多路复用所有请求与订阅（协议 3.0.0，见 AEMobile/doc/传输协议与安全.md）：
//   HELLO → 拿 nonce 和服务器时间
//   AUTH  → HMAC 签名（token 不上网线）
//   REQ   → 一次性请求，按 id 回 RES
//   SUB   → 订阅推送流，按 streamId 收 PUSH
//
// 断线由这里统一重连（指数退避，最长 15s），重连后自动重新订阅并带上 sid，
// 服务端能接着发增量，所以屏幕层不需要再关心重连。
import TcpSocket from 'react-native-tcp-socket';
import { FrameDecoder, PROTOCOL_VERSION, T, encodeFrame } from './protocol';
import { serverNowSec, setClockOffset, tcpAuth } from '../auth';

export interface ConnTarget {
  ip: string;
  port: string;
  token: string;
}

export interface Result<T = any> {
  ok: boolean;
  b: T;
  m?: string;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  onProgress?: (b: any) => void;
  timer?: any;
}

const APP_ID = 'AEMobileApp/3.0.0';
const CONNECT_TIMEOUT_MS = 10000;
/** 单次请求超时。生成计划这种长请求每收到一条进度就续期 */
const REQUEST_TIMEOUT_MS = 20000;
const PING_INTERVAL_MS = 20000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 15000;

/**
 * 一条订阅流。刻意做成 EventSource 的形状（addEventListener / close），
 * 屏幕层的写法和用 SSE 时保持一致。
 */
export class Stream {
  readonly op: string;
  readonly params: Record<string, any>;
  /** 服务端会话 id：重连时带回去，服务端直接发增量 */
  sid = '';
  /** 服务端给的流编号 */
  streamId = 0;
  closed = false;

  private listeners: Record<string, Array<(ev: any) => void>> = {};
  private onClose: () => void;

  constructor(op: string, params: Record<string, any>, onClose: () => void) {
    this.op = op;
    this.params = params;
    this.onClose = onClose;
  }

  addEventListener(type: string, cb: (ev: any) => void): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }

  removeEventListener(type: string, cb: (ev: any) => void): void {
    const list = this.listeners[type];
    if (!list) return;
    this.listeners[type] = list.filter((f) => f !== cb);
  }

  emit(type: string, ev: any): void {
    if (this.closed && type !== 'close') return;
    (this.listeners[type] ?? []).forEach((fn) => {
      try {
        fn(ev);
      } catch {
        // 单个监听器报错不能影响其它监听器
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
    this.emit('close', {});
    this.listeners = {};
  }
}

class TcpClient {
  private socket: any = null;
  private decoder = new FrameDecoder();
  private target: ConnTarget | null = null;
  private key = '';
  private ready = false;
  private connecting: Promise<void> | null = null;
  /** 在途连接对应的目标 key：换目标时旧的在途连接必须作废，不能拿回来 await */
  private connectingKey = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private streams = new Set<Stream>();
  private nonce = '';
  private authRetried = false;
  private retryTimer: any = null;
  private retryDelay = RETRY_MIN_MS;
  private pingTimer: any = null;
  /** 建连+鉴权的超时（react-native-tcp-socket 的 timeout 是空闲超时，不能用来做建连超时） */
  private connectTimer: any = null;
  private hello: { resolve: () => void; reject: (e: any) => void } | null = null;

  /** 服务端版本（握手时拿到，设置页可以显示） */
  serverVersion = '';

  // ------------------------------------------------------------ 连接

  connect(target: ConnTarget): Promise<void> {
    const key = `${target.ip}:${target.port}:${target.token}`;
    if (this.ready && this.key === key) return Promise.resolve();
    if (this.key !== key) {
      // 换服务器/换密码：旧连接上的一切都作废。
      // 注意也要把「在途连接」丢掉 —— 否则新目标会 await 到旧目标的握手 promise，
      // 表现就是「测试连接成功，但获取网络列表失败」（2026-10-28 真机踩到）。
      this.key = key;
      this.target = target;
      this.destroySocket();
      this.connecting = null;
      this.connectingKey = '';
      this.streams.forEach((s) => s.emit('error', { message: '连接已切换' }));
    }
    if (this.connecting && this.connectingKey === key) return this.connecting;
    this.connectingKey = key;
    this.connecting = this.open(target).then(
      () => {
        this.connecting = null;
        this.retryDelay = RETRY_MIN_MS;
      },
      (e) => {
        this.connecting = null;
        throw e;
      },
    );
    return this.connecting;
  }

  private open(target: ConnTarget): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const port = Number(target.port) || 44444;
      this.decoder.reset();
      this.authRetried = false;
      this.hello = { resolve, reject };
      this.clearConnectTimer();
      this.connectTimer = setTimeout(() => {
        this.onSocketError(new Error('连接超时'));
        this.destroySocket();
      }, CONNECT_TIMEOUT_MS);
      let socket: any;
      try {
        socket = TcpSocket.createConnection(
          { host: target.ip, port },
          () => this.send(T.HELLO, { v: PROTOCOL_VERSION, app: APP_ID }),
        );
      } catch (e: any) {
        this.hello = null;
        reject(new Error(e?.message ?? '无法建立连接'));
        return;
      }
      this.socket = socket;
      socket.on('data', (chunk: any) => this.onData(chunk));
      socket.on('error', (err: any) => this.onSocketError(err));
      socket.on('close', () => this.onSocketClose());
    });
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private onSocketError(err: any): void {
    this.clearConnectTimer();
    const message = String(err?.message ?? err ?? '网络错误');
    if (this.hello) {
      const h = this.hello;
      this.hello = null;
      h.reject(new Error(message));
    }
    this.rejectAll(new Error(message));
    this.streams.forEach((s) => s.emit('error', { message }));
  }

  private onSocketClose(): void {
    this.clearConnectTimer();
    const hadSocket = this.socket != null;
    this.socket = null;
    this.ready = false;
    this.stopPing();
    if (this.hello) {
      const h = this.hello;
      this.hello = null;
      h.reject(new Error('连接已断开'));
    }
    this.rejectAll(new Error('连接已断开'));
    this.streams.forEach((s) => s.emit('error', { message: '连接已断开' }));
    if (hadSocket && this.streams.size > 0) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.target || this.streams.size === 0) return;
      this.connect(this.target).catch(() => this.scheduleReconnect());
    }, delay);
  }

  private destroySocket(): void {
    this.clearConnectTimer();
    this.ready = false;
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.destroy();
      } catch {}
    }
  }

  // ------------------------------------------------------------ 收帧

  private onData(chunk: any): void {
    let frames;
    try {
      frames = this.decoder.push(chunk);
    } catch (e: any) {
      this.fail(String(e?.message ?? 'BAD_FRAME'));
      return;
    }
    frames.forEach((f) => this.handleFrame(f.type, f.payload));
  }

  private handleFrame(type: number, payload: any): void {
    switch (type) {
      case T.HELLO_ACK: {
        // 顺带对时：签名用的 ts 只允许 ±600s 偏差
        if (typeof payload?.time === 'number') {
          setClockOffset(payload.time - Date.now() / 1000);
        }
        this.nonce = String(payload?.nonce ?? '');
        this.serverVersion = String(payload?.ver ?? '');
        this.sendAuth();
        break;
      }
      case T.AUTH_OK: {
        this.ready = true;
        this.clearConnectTimer();
        const h = this.hello;
        this.hello = null;
        this.startPing();
        if (h) h.resolve();
        // 重连成功：把还活着的订阅按原 sid 重新挂上，服务端直接续发增量
        this.streams.forEach((s) => this.doSubscribe(s));
        break;
      }
      case T.AUTH_FAIL: {
        const code = String(payload?.code ?? 'AUTH_FAILED');
        if (code === 'CLOCK' && !this.authRetried) {
          // 服务器时间差太多：用它给的时间重签一次
          if (typeof payload?.time === 'number') {
            setClockOffset(payload.time - Date.now() / 1000);
          }
          this.authRetried = true;
          this.sendAuth();
          return;
        }
        const err: any = new Error(code === 'AUTH_FAILED' ? '密码错误或已失效' : code);
        err.code = code;
        err.xhrStatus = code === 'AUTH_FAILED' ? 401 : 0;
        const h = this.hello;
        this.hello = null;
        if (h) h.reject(err);
        this.streams.forEach((s) => s.emit('error', { message: err.message, code, xhrStatus: err.xhrStatus }));
        this.destroySocket();
        break;
      }
      case T.RES: {
        const id = payload?.id;
        const p = this.pending.get(id);
        if (!p) break;
        if (payload?.more) {
          this.arm(p, id);
          if (p.onProgress) p.onProgress(payload.b);
          break;
        }
        if (p.timer) clearTimeout(p.timer);
        this.pending.delete(id);
        p.resolve({ ok: !!payload?.ok, b: payload?.b, m: payload?.m });
        break;
      }
      case T.SUB_OK: {
        const p = this.pending.get(payload?.id);
        if (!p) break;
        if (p.timer) clearTimeout(p.timer);
        this.pending.delete(payload.id);
        p.resolve(payload);
        break;
      }
      case T.PUSH: {
        const streamId = payload?.s;
        for (const s of this.streams) {
          if (s.streamId === streamId) {
            s.emit('message', { data: payload.f });
            break;
          }
        }
        break;
      }
      case T.ERR: {
        this.fail(String(payload?.m ?? '服务端错误'));
        break;
      }
      case T.PONG:
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ 发送

  private send(type: number, payload?: any): void {
    const socket = this.socket;
    if (!socket) return;
    try {
      socket.write(encodeFrame(type, payload));
    } catch (e) {
      this.onSocketError(e);
    }
  }

  private sendAuth(): void {
    if (!this.target) return;
    const ts = serverNowSec();
    const { kid, sig } = tcpAuth(this.target.token, ts, this.nonce);
    this.send(T.AUTH, { kid, ts, sig });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ready) this.send(T.PING, {});
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  // ------------------------------------------------------------ 请求

  async request<T = any>(
    target: ConnTarget,
    op: string,
    params?: Record<string, any>,
    onProgress?: (b: any) => void,
  ): Promise<Result<T>> {
    await this.connect(target);
    return new Promise<Result<T>>((resolve, reject) => {
      const id = this.nextId++;
      const p: Pending = {
        resolve: (r) => resolve({ ok: !!r.ok, b: r.b, m: r.m }),
        reject,
        onProgress,
      };
      this.pending.set(id, p);
      this.arm(p, id);
      this.send(T.REQ, { id, op, p: params ?? {} });
    });
  }

  private arm(p: Pending, id: number): void {
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      this.pending.delete(id);
      p.reject(new Error('TIMEOUT'));
    }, REQUEST_TIMEOUT_MS);
  }

  private rejectAll(err: Error): void {
    const list = Array.from(this.pending.values());
    this.pending.clear();
    list.forEach((p) => {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    });
  }

  private fail(message: string): void {
    this.rejectAll(new Error(message));
    this.streams.forEach((s) => s.emit('error', { message }));
    this.destroySocket();
  }

  // ------------------------------------------------------------ 订阅

  subscribe(target: ConnTarget, op: string, params?: Record<string, any>): Stream {
    const stream = new Stream(op, params ?? {}, () => {
      this.streams.delete(stream);
      if (this.ready && stream.streamId) this.send(T.UNSUB, { s: stream.streamId });
      stream.streamId = 0;
    });
    // 先连上再入册：connect() 换目标时会给「已有」的流发 error，
    // 如果先入册，新屏幕会立刻收到一条假的「连接已切换」。
    this.connect(target).then(
      () => {
        if (stream.closed) return;
        this.streams.add(stream);
        this.doSubscribe(stream);
      },
      (e: any) => stream.emit('error', { message: String(e?.message ?? e), code: e?.code, xhrStatus: e?.xhrStatus }),
    );
    return stream;
  }

  private doSubscribe(stream: Stream): void {
    if (stream.closed || !this.ready) return;
    const id = this.nextId++;
    const p: Pending = {
      resolve: (r) => {
        // 服务端拒绝订阅（如老版本没有这个 op）会回一条 ok:false 的 RES，
        // 这里必须报错，否则界面会显示「已连接」但永远收不到推送。
        if (r && r.ok === false) {
          stream.emit('error', { message: String(r.m ?? '订阅失败') });
          return;
        }
        stream.streamId = r.s;
        if (r.sid) stream.sid = r.sid;
        stream.emit('open', {});
      },
      reject: (e: any) => stream.emit('error', { message: String(e?.message ?? e) }),
    };
    this.pending.set(id, p);
    this.arm(p, id);
    // 优先用服务端这次会话的 sid；没有就用屏幕带上来的（例如物品页 4 分钟内切回来续传）
    const sid = stream.sid || stream.params.sid || undefined;
    this.send(T.SUB, { id, op: stream.op, p: stream.params, sid });
  }
}

export const tcp = new TcpClient();

/**
 * 一次性请求：**自己开一条短连接**（HELLO → AUTH → REQ → 关掉），不碰共享的长连接。
 *
 * 为什么要这样：共享连接只服务「订阅流」，而设置页用的是**还没保存的表单配置**。
 * 如果一次性请求也走共享连接，它和屏幕里的订阅流会互相把对方的连接踢掉
 * （一个要连 A 服、一个要连 B 服，每次 connect 都 destroy 对方），
 * 表现就是「测试连接成功、获取网络列表却失败」（2026-10-28 真机踩到）。
 */
export async function requestOnce<T = any>(
  target: ConnTarget,
  op: string,
  params?: Record<string, any>,
  onProgress?: (b: any) => void,
): Promise<Result<T>> {
  return new Promise<Result<T>>((resolve, reject) => {
    let settled = false;
    let timer: any = null;
    const decoder = new FrameDecoder();
    let socket: any;
    let authDebug: any = null;

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {}
      fn();
    };
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => done(() => reject(new Error('TIMEOUT'))), ms);
    };

    try {
      socket = TcpSocket.createConnection(
        { host: target.ip, port: Number(target.port) || 44444 },
        () => socket.write(encodeFrame(T.HELLO, { v: PROTOCOL_VERSION, app: APP_ID })),
      );
    } catch (e: any) {
      reject(new Error(e?.message ?? '无法建立连接'));
      return;
    }
    arm(CONNECT_TIMEOUT_MS);

    socket.on('data', (chunk: any) => {
      let frames;
      try {
        frames = decoder.push(chunk);
      } catch (e: any) {
        done(() => reject(new Error(String(e?.message ?? 'BAD_FRAME'))));
        return;
      }
      for (const f of frames) {
        if (f.type === T.HELLO_ACK) {
          if (typeof f.payload?.time === 'number') setClockOffset(f.payload.time - Date.now() / 1000);
          const ts = serverNowSec();
          const nonce = String(f.payload?.nonce ?? '');
          const { kid, sig } = tcpAuth(target.token, ts, nonce);
          authDebug = { kid, ts, nonce, sig, serverTime: f.payload?.time };
          socket.write(encodeFrame(T.AUTH, { kid, ts, sig }));
        } else if (f.type === T.AUTH_OK) {
          socket.write(encodeFrame(T.REQ, { id: 1, op, p: params ?? {} }));
          arm(REQUEST_TIMEOUT_MS);
        } else if (f.type === T.AUTH_FAIL) {
          const code = String(f.payload?.code ?? 'AUTH_FAILED');
          // 鉴权失败时把签名要素打出来，方便和服务端 WARN 日志对照（不含 token 本体）
          console.log('[AEMobile][auth-fail] ' + JSON.stringify({ code, len: target.token.length, auth: authDebug }));
          const err: any = new Error(code === 'AUTH_FAILED' ? '密码错误或已失效' : code);
          err.code = code;
          err.xhrStatus = code === 'AUTH_FAILED' ? 401 : 0;
          done(() => reject(err));
        } else if (f.type === T.RES) {
          if (f.payload?.more) {
            arm(REQUEST_TIMEOUT_MS);
            onProgress?.(f.payload.b);
          } else {
            done(() => resolve({ ok: !!f.payload?.ok, b: f.payload?.b, m: f.payload?.m }));
          }
        } else if (f.type === T.ERR) {
          done(() => reject(new Error(String(f.payload?.m ?? '服务端错误'))));
        }
      }
    });
    socket.on('error', (e: any) => done(() => reject(new Error(String(e?.message ?? '连接失败')))));
    socket.on('close', () => done(() => reject(new Error('连接被关闭'))));
  });
}

/** 只握手不鉴权：设置页「测试连接」用，拿服务器版本和时钟偏差 */
export async function probeServer(ip: string, port: string): Promise<{ ver: string; time: number }> {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer: any = null;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    let socket: any;
    timer = setTimeout(() => {
      finish(() => reject(new Error('连接超时')));
      try {
        socket?.destroy();
      } catch {}
    }, CONNECT_TIMEOUT_MS);
    try {
      socket = TcpSocket.createConnection(
        { host: ip, port: Number(port) || 44444 },
        () => socket.write(encodeFrame(T.HELLO, { v: PROTOCOL_VERSION, app: APP_ID })),
      );
    } catch (e: any) {
      reject(new Error(e?.message ?? '无法建立连接'));
      return;
    }
    const decoder = new FrameDecoder();
    socket.on('data', (chunk: any) => {
      try {
        const frames = decoder.push(chunk);
        for (const f of frames) {
          if (f.type === T.HELLO_ACK) {
            finish(() => resolve({ ver: String(f.payload?.ver ?? ''), time: Number(f.payload?.time ?? 0) }));
            try {
              socket.destroy();
            } catch {}
          } else if (f.type === T.ERR) {
            finish(() => reject(new Error(String(f.payload?.m ?? '版本不匹配'))));
          }
        }
      } catch (e: any) {
        finish(() => reject(new Error(String(e?.message ?? 'BAD_FRAME'))));
      }
    });
    socket.on('error', (e: any) => finish(() => reject(new Error(String(e?.message ?? '连接失败')))));
    socket.on('close', () => finish(() => reject(new Error('连接被关闭'))));
  });
}
