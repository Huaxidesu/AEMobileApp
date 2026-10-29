// 内置图标包（编译期嵌入）—— 由 tools/embed_pack.py 生成，别手改
export type BundledPack = { asset: number; sha256: string };

export const BUNDLED_PACKS: Partial<Record<'items' | 'fluids' | 'essentia', BundledPack>> = {
  items: { asset: require('../assets/items.db'), sha256: '0447b43d153db0dadf571ed3bea1fa6352eeb8522b08c8f2d48f95db1bd51345' },
  fluids: { asset: require('../assets/fluids.db'), sha256: 'e7d49507cd69556c80093b032f8945e6a7cb85f70d1cf5e740d69860fc7e322f' },
  essentia: { asset: require('../assets/essentia.db'), sha256: '68230917f616438dc0f2895fbb9ab313bccdcd6437f89308c6d4e7741b8c6667' },
};
