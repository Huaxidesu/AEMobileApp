// 头像地址解析（纯函数，不碰网络与文件系统）。
//
// Mojang 与 LittleSkin 的 Yggdrasil 接口返回同一种 profile 结构：
//   { id, name, properties: [{ name: 'textures', value: '<base64 JSON>' }] }
// base64 里再套一层 { textures: { SKIN: { url } } }。
// 单独放一个文件是为了能用 Node 内置 test runner 直接验证，不依赖 Expo。
import { Buffer } from 'buffer';

export type SkinSource = 'mojang' | 'littleskin';

export const MOJANG_NAME_API = 'https://api.mojang.com/users/profiles/minecraft/';
export const MOJANG_PROFILE_API = 'https://sessionserver.mojang.com/session/minecraft/profile/';
export const LITTLESKIN_NAME_API = 'https://littleskin.cn/api/yggdrasil/api/users/profiles/minecraft/';
export const LITTLESKIN_PROFILE_API =
  'https://littleskin.cn/api/yggdrasil/sessionserver/session/minecraft/profile/';

export function mojangNameUrl(name: string): string {
  return MOJANG_NAME_API + encodeURIComponent(name.trim());
}

export function mojangProfileUrl(uuid: string): string {
  return MOJANG_PROFILE_API + normalizeUuid(uuid);
}

export function littleSkinNameUrl(name: string): string {
  return LITTLESKIN_NAME_API + encodeURIComponent(name.trim());
}

export function littleSkinProfileUrl(uuid: string): string {
  return LITTLESKIN_PROFILE_API + normalizeUuid(uuid);
}

/** 统一成无连字符小写 UUID（Mojang 两种写法都有） */
export function normalizeUuid(id: string): string {
  return String(id ?? '').replace(/-/g, '').trim().toLowerCase();
}

/** 从名字查询结果里取 profile id；查无此人返回 null */
export function profileId(json: unknown): string | null {
  const id = (json as { id?: unknown } | null | undefined)?.id;
  if (typeof id !== 'string') return null;
  const clean = normalizeUuid(id);
  return clean.length > 0 ? clean : null;
}

/**
 * 从 profile 的 textures 属性里取皮肤地址。
 * 没有 SKIN、base64 坏了、JSON 不对都返回 null（调用方换下一个来源）。
 */
export function textureUrlFromProfile(json: unknown): string | null {
  const props = (json as { properties?: unknown } | null | undefined)?.properties;
  if (!Array.isArray(props)) return null;
  for (const p of props) {
    if (!p || typeof p !== 'object') continue;
    const prop = p as { name?: unknown; value?: unknown };
    if (prop.name !== 'textures' || typeof prop.value !== 'string') continue;
    try {
      const decoded = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')) as {
        textures?: { SKIN?: { url?: unknown } };
      };
      const url = decoded?.textures?.SKIN?.url;
      if (typeof url !== 'string' || url.length === 0) continue;
      // 原版皮肤地址是 http，Android 9+ 默认禁止明文，直接换 https
      return url.replace(/^http:\/\//i, 'https://');
    } catch {
      continue;
    }
  }
  return null;
}
