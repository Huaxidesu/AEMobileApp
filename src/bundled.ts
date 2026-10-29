// 内置图标包（编译期嵌入）—— 由 tools/embed_pack.py 生成，别手改
export type BundledPack = { asset: number; sha256: string };

export const BUNDLED_PACKS: Partial<Record<'items' | 'fluids' | 'essentia', BundledPack>> = {
  items: { asset: require('../assets/items.db'), sha256: '0d51b799b2dd2ce18f548b6c5850419195d5a45dd8bb786635e3164c8dfb9f07' },
  fluids: { asset: require('../assets/fluids.db'), sha256: '1d7db1d95299f7f1ef61dd5583ad97244b9b43c00159e6dbab77202f10866396' },
  essentia: { asset: require('../assets/essentia.db'), sha256: '68230917f616438dc0f2895fbb9ab313bccdcd6437f89308c6d4e7741b8c6667' },
};
