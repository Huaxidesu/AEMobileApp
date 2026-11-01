// 当前连的这台子服在群组服里的显示名（例如「天空树」），以及它能提供哪些可选能力。
//
// 来源：握手 `HELLO_ACK.srv` / `HELLO_ACK.caps`，由 `net/conn.ts` 写入。
//
// **能力位解决的是「功能坏了」和「这台服没这个功能」分不清的问题**：
// 队伍 / 服务器 / 世界标签全靠服务端的 GTNHChat 喂数据，没装那个模组的服上
// 这些 UI 本来就没有内容。以前 App 只能看「这条消息有没有字段」，于是设置项照常显示、
// 点了没反应。现在服务端在握手时直接报一句「我有哪几项」，App 按这个收敛 UI。
//
// 没报过（老服务端）= 不知道，按「有」处理 —— 老版本什么都不报，但功能可能是好的，
// 不能因为升级 App 就让人家少东西。
//
// 单独一个模块是为了断开循环依赖：`net/conn.ts` 写、视图层读，两边都不需要 import 对方。
// 这里不 import react-native，单测可以直接跑。

/** 服务端能提供的可选能力，和 AEMobile 的 `compat/GtnChatCompat` 一一对应 */
export type Cap = 'chat' | 'team' | 'world' | 'relay';

let current = '';
/** null = 这台服务端没报过（老版本），按「全都有」处理 */
let caps: Cap[] | null = null;

export function setLocalServerName(name: string): void {
  current = name || '';
}

export function localServerName(): string {
  return current;
}

/** 握手时写入；不认识的项直接丢掉，服务端以后加新能力也不会影响老 App */
export function setCaps(value: unknown): void {
  if (!Array.isArray(value)) {
    caps = null;
    return;
  }
  const known: Cap[] = ['chat', 'team', 'world', 'relay'];
  caps = value.filter((v): v is Cap => typeof v === 'string' && (known as string[]).includes(v));
}

/** 这台服务端有没有报过能力位（false = 老版本，UI 保持原样） */
export function capsReported(): boolean {
  return caps !== null;
}

/**
 * 是否有某项能力。没报过时一律返回 true（老服务端按「有」处理，保持现状）。
 *
 * 注意这是**整台服**的属性，不是「这条消息有没有这个字段」——
 * 某个人没队伍 → 那条消息本来就不该有队伍标签，那是另一回事。
 */
export function hasCap(cap: Cap): boolean {
  if (caps === null) return true;
  return caps.includes(cap);
}

/** 调试 / 设置页说明用 */
export function capsList(): Cap[] {
  return caps ?? [];
}
