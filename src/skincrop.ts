// 皮肤头部裁剪的几何计算（纯函数，有单测）。
//
// 皮肤里头部正面在 (8,8)、8×8 像素；帽子层在 (40,8)。
// 显示时把整张皮肤放大到「8 个皮肤像素 = 头像边长 size」，所以：
//   1 皮肤像素 = size / 8
//   头部偏移   = 8  * (size/8) = size
//   帽子偏移   = 40 * (size/8) = 5*size
// 图片宽高按真实皮肤尺寸算：64×64 是 8*size，128×128 是 16*size，64×32 高度减半。
export interface SkinCrop {
  /** 整张皮肤渲染出来的尺寸（必须显式给 height，file:// 图片在绝对定位下不给高度会变成 0） */
  imageWidth: number;
  imageHeight: number;
  left: number;
  top: number;
  hatLeft: number;
}

export function skinCrop(size: number, skinWidth = 64, skinHeight = 64): SkinCrop {
  if (size <= 0) return { imageWidth: 0, imageHeight: 0, left: 0, top: 0, hatLeft: 0 };
  const unit = size / 8;
  return {
    imageWidth: Math.max(1, skinWidth) * unit,
    imageHeight: Math.max(1, skinHeight) * unit,
    left: -8 * unit,
    top: -8 * unit,
    hatLeft: -40 * unit,
  };
}
