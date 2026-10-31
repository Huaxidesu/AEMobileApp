import test from 'node:test';
import assert from 'node:assert/strict';
import { lookup, questName, uuidToBq, warmup, zh, zhLines } from '../src/zhdict.ts';

test('已知物品名能翻成中文', () => {
  warmup();
  assert.equal(lookup('Steam Alloy Smelter'), '蒸汽合金炉');
});

test('查不到的返回 undefined，zh 原样返回', () => {
  assert.equal(lookup('This Item Does Not Exist 12345'), undefined);
  assert.equal(zh('This Item Does Not Exist 12345'), 'This Item Does Not Exist 12345');
});

test('空值与 undefined 不抛异常', () => {
  assert.equal(lookup(undefined), undefined);
  assert.equal(lookup(''), undefined);
  assert.equal(zhLines(undefined), '');
});

test('多行 tooltip 逐行翻译，翻不了的行留着', () => {
  const raw = 'Steam Alloy Smelter\nDurability: 100';
  const out = zhLines(raw);
  assert.equal(out.split('\n')[0], '蒸汽合金炉');
  assert.equal(out.split('\n')[1], 'Durability: 100');
});

test('单行 tooltip 走整串匹配', () => {
  assert.equal(zhLines('Steam Alloy Smelter'), '蒸汽合金炉');
});

test('带格式化占位符的条目已被过滤掉', () => {
  warmup();
  // 生成脚本会丢掉含 % 的条目，避免手机端显示成乱码
  for (const en of ['%1$s %2$sA Dynamo Hatch']) {
    assert.equal(lookup(en), undefined);
  }
});

test('UUID 转 BQ 的 22 位 base64', () => {
  assert.equal(uuidToBq('00000000-0000-0000-0000-000000000000'), 'AAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(uuidToBq('not-a-uuid'), null);
});

test('任务名：base64 与 UUID 两种写法都能查到', () => {
  const byB64 = questName('AAAAAAAAAAAAAAAAAAAAAA');
  assert.ok(byB64 && byB64.length > 0);
  const byUuid = questName('00000000-0000-0000-0000-000000000000');
  assert.equal(byUuid, byB64);
});

test('查不到的任务返回 undefined', () => {
  assert.equal(questName('zzzzzzzzzzzzzzzzzzzzzz'), undefined);
  assert.equal(questName(undefined), undefined);
  assert.equal(questName(''), undefined);
});
