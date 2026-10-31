import test from 'node:test';
import assert from 'node:assert/strict';
import { attDetail, attLabel, parseAtt } from '../src/chatatt.ts';

test('解析物品附件：名字与悬停提示', () => {
  const list = parseAtt('[{"t":"item","n":"钢锭","h":"GT 钢锭\\n耐久 3/3"}]');
  assert.equal(list.length, 1);
  assert.equal(list[0].t, 'item');
  assert.equal(attLabel(list[0]), '钢锭');
  assert.equal(attDetail(list[0]), 'GT 钢锭\n耐久 3/3');
});

test('解析任务附件：只带 ID', () => {
  const list = parseAtt('[{"t":"quest","i":"0123456789abcdef"}]');
  assert.equal(list.length, 1);
  assert.equal(attLabel(list[0]), '分享了一个任务');
  assert.ok(attDetail(list[0]).includes('0123456789abcdef'));
});

test('一条消息可以带多个附件', () => {
  const list = parseAtt('[{"t":"item","n":"铜锭"},{"t":"quest","i":"abc12345"}]');
  assert.equal(list.length, 2);
});

test('物品没有名字时退回默认标题', () => {
  assert.equal(attLabel({ t: 'item' }), '物品');
  assert.equal(attDetail({ t: 'item' }), '');
});

test('空值、坏 JSON、非数组、未知类型都返回空表', () => {
  assert.deepEqual(parseAtt(undefined), []);
  assert.deepEqual(parseAtt(''), []);
  assert.deepEqual(parseAtt('not json'), []);
  assert.deepEqual(parseAtt('{"t":"item","n":"x"}'), []);
  assert.deepEqual(parseAtt('[{"t":"other"}]'), []);
});

test('数组里混入的非法条目被丢掉，合法的留下', () => {
  const list = parseAtt('[null,{"t":"item","n":"石头"},{"t":"nope"},42]');
  assert.equal(list.length, 1);
  assert.equal(list[0].n, '石头');
});
