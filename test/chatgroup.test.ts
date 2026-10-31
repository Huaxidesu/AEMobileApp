import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, dayLabel, MERGE_MS } from '../src/chatgroup.ts';
import type { ChatLike } from '../src/chatgroup.ts';

const T0 = new Date(2026, 9, 30, 12, 0, 0).getTime();
const MIN = 60 * 1000;

let seq = 0;
function msg(kind: number, name: string, ts: number, text = 'x'): ChatLike {
  seq += 1;
  return { boot: 1, seq, ts, kind, name, text };
}

test('同一发送者 5 分钟内合并成一组', () => {
  const rows = buildRows([msg(0, 'Steve', T0), msg(0, 'Steve', T0 + MIN)], { mine: '' });
  assert.equal(rows.length, 2); // 日期 + 组
  assert.equal(rows[0].type, 'day');
  assert.equal(rows[1].type, 'group');
  if (rows[1].type === 'group') {
    assert.equal(rows[1].msgs.length, 2);
    assert.equal(rows[1].name, 'Steve');
  }
});

test('间隔超过 5 分钟断开成两组', () => {
  const rows = buildRows([msg(0, 'Steve', T0), msg(0, 'Steve', T0 + MERGE_MS + 1)], { mine: '' });
  const groups = rows.filter((r) => r.type === 'group');
  assert.equal(groups.length, 2);
});

test('换发送者断开', () => {
  const rows = buildRows([msg(0, 'Steve', T0), msg(0, 'Alex', T0 + MIN)], { mine: '' });
  const groups = rows.filter((r) => r.type === 'group');
  assert.equal(groups.length, 2);
});

test('App 与游戏内同名玩家不合并、共享昵称也不合并', () => {
  const rows = buildRows([msg(0, 'Steve', T0), msg(1, 'Steve', T0 + 1000)], { mine: '' });
  const groups = rows.filter((r) => r.type === 'group');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].type === 'group' && groups[0].kind, 0);
  assert.equal(groups[1].type === 'group' && groups[1].kind, 1);
});

test('系统行不并入消息组，并打断合并', () => {
  const rows = buildRows(
    [msg(0, 'Steve', T0), msg(2, 'Alex', T0 + 1000), msg(0, 'Steve', T0 + 2000)],
    { mine: '' },
  );
  const groups = rows.filter((r) => r.type === 'group');
  const systems = rows.filter((r) => r.type === 'system');
  assert.equal(systems.length, 1);
  assert.equal(groups.length, 2);
  assert.equal(systems[0].type === 'system' && systems[0].join, true);
});

test('退出提示标记为非加入', () => {
  const rows = buildRows([msg(3, 'Alex', T0)], { mine: '' });
  const system = rows.find((r) => r.type === 'system');
  assert.ok(system && system.type === 'system');
  assert.equal(system.type === 'system' && system.join, false);
});

test('跨天插入日期行并断开合并', () => {
  const late = new Date(2026, 9, 30, 23, 59, 0).getTime();
  const early = new Date(2026, 9, 31, 0, 1, 0).getTime();
  const rows = buildRows([msg(0, 'Steve', late), msg(0, 'Steve', early)], { mine: '' });
  assert.equal(rows.filter((r) => r.type === 'day').length, 2);
  assert.equal(rows.filter((r) => r.type === 'group').length, 2);
});

test('自己的消息标记 mine', () => {
  const rows = buildRows([msg(1, '老王', T0), msg(1, '别人', T0 + 1000)], { mine: '老王' });
  const groups = rows.filter((r) => r.type === 'group');
  assert.equal(groups[0].type === 'group' && groups[0].mine, true);
  assert.equal(groups[1].type === 'group' && groups[1].mine, false);
});

test('空输入返回空数组', () => {
  assert.deepEqual(buildRows([], { mine: '老王' }), []);
});

test('关掉进出提示时不打断同一人的合并', () => {
  const rows = buildRows(
    [msg(0, 'Steve', T0), msg(2, 'Alex', T0 + 1000), msg(0, 'Steve', T0 + 2000)],
    { mine: '', showJoinLeave: false },
  );
  assert.equal(rows.filter((r) => r.type === 'system').length, 0);
  const groups = rows.filter((r) => r.type === 'group');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type === 'group' && groups[0].msgs.length, 2);
});

test('关掉进出提示时，只有系统行的那天不留空日期头', () => {
  const day2 = T0 + 24 * 3600 * 1000;
  const rows = buildRows(
    [msg(2, 'Alex', T0), msg(0, 'Steve', day2)],
    { mine: '', showJoinLeave: false, now: day2 },
  );
  assert.equal(rows.filter((r) => r.type === 'day').length, 1);
  assert.equal(rows.filter((r) => r.type === 'system').length, 0);
  assert.equal(rows.filter((r) => r.type === 'group').length, 1);
});

test('dayLabel：今天 / 昨天 / 今年更早 / 跨年', () => {
  assert.equal(dayLabel(T0, T0 + 2 * 3600 * 1000), '今天');
  assert.equal(dayLabel(T0 - 24 * 3600 * 1000, T0), '昨天');
  assert.equal(dayLabel(new Date(2026, 8, 1, 9, 0).getTime(), T0), '9月1日');
  assert.equal(dayLabel(new Date(2025, 11, 24, 9, 0).getTime(), T0), '2025年12月24日');
});

test('群组服：不同来源服务器的同名玩家不并成一组', () => {
  const a = { ...msg(0, 'Steve', T0), srv: '生存服' };
  const b = { ...msg(0, 'Steve', T0 + MIN), srv: '创造服' };
  const rows = buildRows([a, b], { mine: '' });
  const groups = rows.filter((r) => r.type === 'group');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].type === 'group' && groups[0].srv, '生存服');
  assert.equal(groups[1].type === 'group' && groups[1].srv, '创造服');
});

test('群组服：同一服务器的同一玩家照常合并，分组带来源', () => {
  const a = { ...msg(0, 'Steve', T0), srv: '生存服' };
  const b = { ...msg(0, 'Steve', T0 + MIN), srv: '生存服' };
  const rows = buildRows([a, b], { mine: '' });
  const groups = rows.filter((r) => r.type === 'group');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type === 'group' && groups[0].msgs.length, 2);
  assert.equal(groups[0].type === 'group' && groups[0].srv, '生存服');
});

test('本服消息没有来源服务器', () => {
  const rows = buildRows([msg(0, 'Steve', T0)], { mine: '' });
  const g = rows.find((r) => r.type === 'group');
  assert.equal(g?.type === 'group' && g.srv, '');
});

test('同一世界照常合并，分组带上世界名', () => {
  const a = { ...msg(0, 'Steve', T0), world: '主世界' };
  const b = { ...msg(0, 'Steve', T0 + MIN), world: '主世界' };
  const rows = buildRows([a, b], { mine: '' });
  const groups = rows.filter((r) => r.type === 'group');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type === 'group' && groups[0].msgs.length, 2);
  assert.equal(groups[0].type === 'group' && groups[0].world, '主世界');
});

test('同一个人换了世界要另起一组（否则世界标签会挂错）', () => {
  const a = { ...msg(0, 'Steve', T0), world: '主世界' };
  const b = { ...msg(0, 'Steve', T0 + MIN), world: '下界' };
  const rows = buildRows([a, b], { mine: '' });
  const groups = rows.filter((r) => r.type === 'group');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].type === 'group' && groups[0].world, '主世界');
  assert.equal(groups[1].type === 'group' && groups[1].world, '下界');
});

test('没有世界名的消息不并进有世界名的组', () => {
  const a = { ...msg(0, 'Steve', T0), world: '主世界' };
  const b = msg(0, 'Steve', T0 + MIN); // 老服务端不发世界名
  const rows = buildRows([a, b], { mine: '' });
  const groups = rows.filter((r) => r.type === 'group');
  assert.equal(groups.length, 2);
  assert.equal(groups[1].type === 'group' && groups[1].world, '');
});
