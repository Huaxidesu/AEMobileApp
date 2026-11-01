// 当前连的这台子服在群组服里的显示名（例如「天空树」）。
//
// 单独一个模块是为了断开循环依赖：`net/conn.ts` 在握手时写入，`chatview.tsx` 读取，
// 两边都不需要 import 对方。
//
// 用途只有一个：手机端要区分「本服」和「别的服」—— 本服消息的来源标签显示成灰色，
// 跨服消息才用玩家配的服务器色。没装 GTNHChat（服务端拿不到名字）时是空串，
// 这时 App 一视同仁，不做区分。

let current = '';

/** 握手（HELLO_ACK）里带下来的本服显示名；空串表示服务端没给 */
export function setLocalServerName(name: string): void {
  current = name || '';
}

export function localServerName(): string {
  return current;
}
