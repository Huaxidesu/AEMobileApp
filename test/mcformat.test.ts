import test from 'node:test';
import assert from 'node:assert/strict';
import { mentions, parseMc, plainMc, readable, splitMention } from '../src/mcformat.ts';

test('颜色码切成片段，§r 回到默认', () => {
  const segs = parseMc('§e晚上开荒§r，谁来？');
  assert.equal(segs.length, 2);
  assert.equal(segs[0].text, '晚上开荒');
  assert.equal(segs[0].color, readable('#FFFF55'));
  assert.equal(segs[1].text, '，谁来？');
  assert.equal(segs[1].color, undefined);
});

test('没有颜色码时整条是一个片段', () => {
  const segs = parseMc('普通消息');
  assert.equal(segs.length, 1);
  assert.equal(segs[0].text, '普通消息');
  assert.equal(segs[0].color, undefined);
});

test('& 和 § 等价，大小写都认', () => {
  assert.equal(plainMc('&c红§C色'), '红色');
  assert.equal(parseMc('&a绿')[0].color, readable('#55FF55'));
});

test('§l 和颜色码叠加，换颜色不清粗体（和游戏一致）', () => {
  const segs = parseMc('§l§c粗红');
  assert.equal(segs[0].bold, true);
  assert.equal(segs[0].color, readable('#FF5555'));
  const segs2 = parseMc('§l§c粗红§a普通');
  assert.equal(segs2.length, 2);
  assert.equal(segs2[1].bold, true, '换颜色后粗体应当保留');
  assert.equal(segs2[1].color, readable('#55FF55'));
});

test('§k 被吞掉但文字保留', () => {
  const segs = parseMc('§k乱码§r正常');
  assert.equal(segs[0].text, '乱码');
  assert.equal(plainMc('§k乱码'), '乱码');
});

test('孤立的 § 当普通字符，不会吃掉后面的字', () => {
  assert.equal(plainMc('100§ 折扣'), '100§ 折扣');
});

test('太暗的颜色会被提亮，正常颜色原样返回', () => {
  const dark = readable('#000000');
  assert.notEqual(dark, '#000000');
  assert.equal(readable('#FF5555'), '#FF5555');
});

test('@我 命中，@我2 不算', () => {
  assert.equal(mentions('@老王 来一下', '老王'), true);
  assert.equal(mentions('@老王2 来一下', '老王'), false);
  assert.equal(mentions('@老王 来一下', ''), false);
});

test('@ 命中不受颜色码影响', () => {
  assert.equal(mentions('§b@老王§r 你好', '老王'), true);
});

test('splitMention 切出命中片段', () => {
  const parts = splitMention('§b@老王 你好', '老王');
  const hits = parts.filter((p) => p.hit).map((p) => p.text);
  assert.deepEqual(hits, ['@老王']);
  assert.equal(
    parts.map((p) => p.text).join(''),
    '§b@老王 你好',
  );
});

test('splitMention 没命中时原样返回一段', () => {
  const parts = splitMention('随便说说', '老王');
  assert.equal(parts.length, 1);
  assert.equal(parts[0].hit, false);
});
