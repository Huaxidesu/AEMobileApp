// 鉴权签名：token 不上网线，只发 kid + HMAC-SHA256 签名。
//
// 协议 3.0.0（TCP）的流程：
//   1. 客户端发 HELLO，服务端回 HELLO_ACK { time, nonce }
//   2. 客户端用 nonce 签 "AE2TCP\n<ts>\n<nonce>"，发 AUTH { kid, ts, sig }
//   nonce 每条连接一个新值 → 抓到的 AUTH 帧换条连接就失效（天然防重放）
//
// 服务端实现见 AEMobile 仓库 net/AuthTokens.java、net/TcpConnection.java；
// 契约见 doc/传输协议与安全.md §3。
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 服务器时间 - 本机时间（秒）。手机时钟偏差会让签名全部失效，所以必须校正。 */
let clockOffsetSec = 0;

export function setClockOffset(sec: number): void {
  clockOffsetSec = Number.isFinite(sec) ? Math.round(sec) : 0;
}

export function getClockOffset(): number {
  return clockOffsetSec;
}

/** 校正后的当前时间（秒），签名里的 ts 用它 */
export function serverNowSec(): number {
  return Math.floor(Date.now() / 1000) + clockOffsetSec;
}

/** Uint8Array → base64url（无填充）。RN 的 btoa 不可靠，自己实现。 */
export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL[b2 & 63];
  }
  return out;
}

/** 规范化用户粘贴的 token：去掉空白、转大写（服务端存的是大写） */
export function normalizeToken(raw: string): string {
  return (raw || '').replace(/\s+/g, '').toUpperCase();
}

/** token 的前 8 字符，服务端用它定位 token */
export function kidOf(token: string): string {
  return normalizeToken(token).slice(0, 8);
}

/** 对规范串签名（base64url）。单独导出是为了能和服务端实现做对拍测试。 */
export function signCanonical(token: string, canonical: string): string {
  const key = normalizeToken(token);
  return base64url(hmac(sha256, utf8ToBytes(key), utf8ToBytes(canonical)));
}

/**
 * 生成 AUTH 帧的字段。
 *
 * 规范串（3 行，与服务端 TcpConnection.onAuth 逐字节一致）：
 *   AE2TCP \n ts \n nonce
 */
export function tcpAuth(token: string, ts: number, nonce: string): { kid: string; sig: string } {
  return {
    kid: kidOf(token),
    sig: signCanonical(token, `AE2TCP\n${ts}\n${nonce}`),
  };
}
