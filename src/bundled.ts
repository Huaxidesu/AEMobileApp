// 内置图标包（编译期嵌入）
//
// 默认是空的：图标是各模组的艺术作品，不随公开仓库分发，玩家通过「订阅图标源」在线下载。
// 服主想给玩家一份开箱即用的 APK 时，用 tools/embed_pack.py 生成本文件（会把 assets/*.db 和
// 它们的 sha256 写进来），再打包 APK —— 这样 App 首次启动就有图标，不用联网。
//
// 生成后的样子：
//   export const BUNDLED_PACKS = {
//     items: { asset: require('../assets/items.db'), sha256: '...' },
//     fluids: { asset: require('../assets/fluids.db'), sha256: '...' },
//     essentia: { asset: require('../assets/essentia.db'), sha256: '...' },
//   };
export type BundledPack = { asset: number; sha256: string };

export const BUNDLED_PACKS: Partial<Record<'items' | 'fluids' | 'essentia', BundledPack>> = {};
