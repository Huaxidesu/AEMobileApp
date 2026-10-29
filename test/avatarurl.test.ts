import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mojangNameUrl,
  mojangProfileUrl,
  littleSkinNameUrl,
  littleSkinProfileUrl,
  profileId,
  textureUrlFromProfile,
  normalizeUuid,
} from '../src/avatarurl.ts';

function profileWithTexture(url: string, id = '069a79f444e94726a5befca90e38aaf5') {
  const value = Buffer.from(
    JSON.stringify({ textures: { SKIN: { url } } }),
    'utf8',
  ).toString('base64');
  return { id, name: 'Notch', properties: [{ name: 'textures', value }] };
}

test('Mojang 名字与档案地址', () => {
  assert.equal(mojangNameUrl('Notch'), 'https://api.mojang.com/users/profiles/minecraft/Notch');
  assert.equal(
    mojangProfileUrl('069a79f444e94726a5befca90e38aaf5'),
    'https://sessionserver.mojang.com/session/minecraft/profile/069a79f444e94726a5befca90e38aaf5',
  );
});

test('LittleSkin 名字与档案地址', () => {
  assert.equal(
    littleSkinNameUrl('Notch'),
    'https://littleskin.cn/api/yggdrasil/api/users/profiles/minecraft/Notch',
  );
  assert.equal(
    littleSkinProfileUrl('97680b82f3e84740ae26e4089ad2d9aa'),
    'https://littleskin.cn/api/yggdrasil/sessionserver/session/minecraft/profile/97680b82f3e84740ae26e4089ad2d9aa',
  );
});

test('名字里的空格 / 中文要编码', () => {
  assert.equal(mojangNameUrl('a b'), 'https://api.mojang.com/users/profiles/minecraft/a%20b');
  assert.equal(littleSkinNameUrl('老王'), 'https://littleskin.cn/api/yggdrasil/api/users/profiles/minecraft/%E8%80%81%E7%8E%8B');
});

test('profileId 去掉连字符并转小写', () => {
  assert.equal(profileId({ id: '069A79F4-44E9-4726-A5BE-FCA90E38AAF5' }), '069a79f444e94726a5befca90e38aaf5');
  assert.equal(profileId({ id: '  ABC  ' }), 'abc');
  assert.equal(profileId(null), null);
  assert.equal(profileId({}), null);
});

test('normalizeUuid 去连字符', () => {
  assert.equal(normalizeUuid('069A79F4-44E9-4726-A5BE-FCA90E38AAF5'), '069a79f444e94726a5befca90e38aaf5');
});

test('从 textures 属性解出皮肤地址，并把 http 转成 https', () => {
  const json = profileWithTexture('http://textures.minecraft.net/texture/abc');
  assert.equal(textureUrlFromProfile(json), 'https://textures.minecraft.net/texture/abc');
});

test('LittleSkin 的 https 皮肤地址原样返回', () => {
  const url = 'https://littleskin.cn/textures/da25c84aaa1a3ab047eeacbdaf6b91d6efa54508e67172a6e2f8322670e8229';
  assert.equal(textureUrlFromProfile(profileWithTexture(url)), url);
});

test('没有 SKIN / 没有 properties / 坏 base64 返回 null', () => {
  assert.equal(textureUrlFromProfile({ id: 'x', properties: [] }), null);
  assert.equal(textureUrlFromProfile({}), null);
  assert.equal(textureUrlFromProfile(null), null);
  assert.equal(
    textureUrlFromProfile({ properties: [{ name: 'textures', value: '!!!not-base64!!!' }] }),
    null,
  );
  assert.equal(
    textureUrlFromProfile({
      properties: [{ name: 'cape', value: Buffer.from('{}').toString('base64') }],
    }),
    null,
  );
});
