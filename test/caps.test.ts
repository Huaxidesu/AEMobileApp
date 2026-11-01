// 服务端能力位（HELLO_ACK.caps）的解析与判定。
//
// 这套东西的价值全在「默认值」上：老服务端不报 caps 时不能把 UI 砍掉，
// 新服务端明确报了空数组时才关掉 —— 三种情况各测一条。
import test from 'node:test';
import assert from 'node:assert/strict';
import { capsList, capsReported, hasCap, setCaps, setLocalServerName, localServerName } from '../src/serverinfo.ts';

test('老服务端没报 caps：按「有」处理，UI 保持原样', () => {
  setCaps(undefined);
  assert.equal(capsReported(), false);
  assert.equal(hasCap('chat'), true);
  assert.equal(hasCap('team'), true);
  assert.equal(hasCap('world'), true);
  assert.equal(hasCap('relay'), true);
  assert.deepEqual(capsList(), []);
});

test('服务端没装 GTNHChat：空数组，四项全关', () => {
  setCaps([]);
  assert.equal(capsReported(), true);
  assert.equal(hasCap('chat'), false);
  assert.equal(hasCap('team'), false);
  assert.equal(hasCap('world'), false);
  assert.equal(hasCap('relay'), false);
});

test('装了 GTNHChat 但没装 ServerUtilities：有 chat/world，没有 team', () => {
  setCaps(['chat', 'world']);
  assert.equal(hasCap('chat'), true);
  assert.equal(hasCap('world'), true);
  assert.equal(hasCap('team'), false);
  assert.equal(hasCap('relay'), false);
});

test('服务端以后加新能力：老 App 丢掉不认识项，不影响已知项', () => {
  setCaps(['chat', 'team', 'world', 'relay', 'voice', 42, null]);
  assert.deepEqual(capsList(), ['chat', 'team', 'world', 'relay']);
  assert.equal(hasCap('relay'), true);
});

test('不是数组的脏值当作「没报过」，不能把 UI 砍掉', () => {
  setCaps('chat');
  assert.equal(capsReported(), false);
  assert.equal(hasCap('chat'), true);
});

test('本服显示名独立于能力位', () => {
  setLocalServerName('天空树');
  assert.equal(localServerName(), '天空树');
  setLocalServerName('');
  assert.equal(localServerName(), '');
});
