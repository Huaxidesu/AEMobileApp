import test from 'node:test';
import assert from 'node:assert/strict';
import { skinCrop } from '../src/skincrop.ts';

test('64×64 皮肤、32px 头像：头部 8 像素 = 32px，偏移 -32', () => {
  const c = skinCrop(32, 64);
  assert.equal(c.imageWidth, 256);
  assert.equal(c.left, -32);
  assert.equal(c.top, -32);
  assert.equal(c.hatLeft, -160);
});

test('128×128 高清皮肤：图片放大一倍，但头部偏移仍是 -size', () => {
  const c = skinCrop(32, 128);
  assert.equal(c.imageWidth, 512);
  assert.equal(c.left, -32);
  assert.equal(c.top, -32);
  assert.equal(c.hatLeft, -160);
});

test('64×32 老皮肤：宽度不变，头部坐标同样适用', () => {
  const c = skinCrop(24, 64);
  assert.equal(c.imageWidth, 192);
  assert.equal(c.left, -24);
  assert.equal(c.hatLeft, -120);
});

test('尺寸为 0 时所有偏移都是 0', () => {
  const c = skinCrop(0, 64);
  assert.equal(c.imageWidth, 0);
  assert.equal(c.left, 0);
  assert.equal(c.hatLeft, 0);
});
