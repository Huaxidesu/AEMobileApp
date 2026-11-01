// 当前连的这台子服在群组服里的显示名（例如「天空树」）。
//
// 来源：握手 `HELLO_ACK.srv`，由 `net/conn.ts` 写入。没装 GTNHChat 时是空串。
//
// **目前没有 UI 在读它**。2026-11-01 本来用它把「本服 / 跨服」的服务器标签分成灰 / 彩两档，
// 用户觉得灰色不好看，改回统一橙色了。这个值本身仍然是对的事实（App 知道自己连的是哪个子服），
// 以后要区分本服/跨服、或者按服过滤消息，直接用这个 getter 就行，不用再动协议。
//
// 单独一个模块是为了断开循环依赖：`net/conn.ts` 写、视图层读，两边都不需要 import 对方。

let current = '';

export function setLocalServerName(name: string): void {
  current = name || '';
}

export function localServerName(): string {
  return current;
}
