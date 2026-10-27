// TCP 帧编解码（协议 3.0.0）。
//
// 帧格式： [len:4B 大端][type:1B][flags:1B][payload: UTF-8 JSON]
//   len = type + flags + payload 的总字节数（不含自身）
//
// 服务端实现见 AEMobile 仓库 net/Protocol.java，契约见 doc/传输协议与安全.md §2。
import { Buffer } from 'buffer';

export const PROTOCOL_VERSION = 3;

/** 帧类型，必须和 Protocol.java 里的常量逐一对上 */
export const T = {
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
} as const;

// 实测真实基地的 items 全量帧 2.97MB（13316 条），留足余量
const MAX_FRAME = 16 * 1024 * 1024;

export interface Frame {
  type: number;
  payload: any;
}

/** 组一帧（payload 为 undefined 时是空帧，如 PING/PONG） */
export function encodeFrame(type: number, payload?: any): Uint8Array {
  const body =
    payload === undefined || payload === null
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(payload), 'utf8');
  const out = Buffer.allocUnsafe(6 + body.length);
  out.writeInt32BE(2 + body.length, 0);
  out.writeUInt8(type, 4);
  out.writeUInt8(0, 5); // flags：保留
  body.copy(out, 6);
  return out;
}

/**
 * 粘包/半包处理器。
 *
 * TCP 是字节流，一次 `data` 事件可能是半帧、也可能好几帧粘在一起，
 * 必须自己按长度前缀切。
 */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): Frame[] {
    const incoming = Buffer.from(chunk as any);
    this.buf = this.buf.length ? Buffer.concat([this.buf, incoming]) : incoming;

    const out: Frame[] = [];
    for (;;) {
      if (this.buf.length < 4) break;
      const len = this.buf.readInt32BE(0);
      if (len < 2 || len > MAX_FRAME) throw new Error(`BAD_FRAME_LENGTH:${len}`);
      if (this.buf.length < 4 + len) break;

      const type = this.buf.readUInt8(4);
      // ⚠️ 必须用 Buffer.prototype.toString(encoding, start, end)。
      // 在 Hermes 里 `buf.subarray(a, b).toString('utf8')` 会退化成 Uint8Array 的
      // toString（返回 "123,34,118,..." 这种字节列表），JSON.parse 必然失败 →
      // 帧内容全变 null（2026-10-28 真机踩到：nonce 为空导致鉴权签名永远不匹配）。
      const text = this.buf.toString('utf8', 6, 4 + len);
      let payload: any = null;
      if (text.length > 0) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
      out.push({ type, payload });
      // 同理：subarray 在 polyfill 下可能不是 Buffer，拷一份保证后续 read* 能用
      this.buf = Buffer.from(this.buf.subarray(4 + len));
    }
    return out;
  }

  reset(): void {
    this.buf = Buffer.alloc(0);
  }
}
