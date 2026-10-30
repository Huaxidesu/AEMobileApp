import test from 'node:test';
import assert from 'node:assert/strict';
import { friendly, parseEntries, parseOutput, stripHints } from '../src/musicout.ts';

test('stripHints 去掉行尾的 [点我…]', () => {
  assert.equal(stripHints('/music list 查看歌曲队列[点我选择]'), '/music list 查看歌曲队列');
  assert.equal(stripHints('/music 来点歌[点我查看]'), '/music 来点歌');
  assert.equal(stripHints('没有提示'), '没有提示');
});

test('parseEntries 解析搜索结果', () => {
  const entries = parseEntries(['1->晴天 | 周杰伦 | 叶惠美[点我选择]', '2->稻香 | 周杰伦 | 魔杰座']);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => [e.index, e.title, e.artist, e.album]),
    [
      [1, '晴天', '周杰伦', '叶惠美'],
      [2, '稻香', '周杰伦', '魔杰座'],
    ],
  );
});

test('parseOutput：搜索结果变成可点的 select 动作', () => {
  const { actions, texts } = parseOutput(['1->晴天 | 周杰伦 | 叶惠美[点我选择]', '2->稻香 | 周杰伦']);
  assert.equal(texts.length, 0);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].kind, 'select');
  assert.equal(actions[0].index, 1);
  assert.equal(actions[0].label, '晴天');
  assert.equal(actions[0].sub, '周杰伦 · 叶惠美');
});

test('parseOutput：`[点我选择]` 的命令行变成 command 动作', () => {
  const { actions } = parseOutput(['[肥猫电台]/music stop 停止播放歌曲[点我选择]']);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'command');
  assert.equal(actions[0].cmd, 'stop');
  assert.deepEqual(actions[0].args, []);
  assert.equal(actions[0].label, '/music stop');
  assert.equal(actions[0].sub, '停止播放歌曲');
  assert.ok(!actions[0].needsArg);
});

test('parseOutput：占位符在第一位的命令标成 needsArg，cmd 留空', () => {
  const { actions } = parseOutput(['[肥猫电台]/music [音乐ID] 来点歌[点我查看]']);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].needsArg, true);
  assert.equal(actions[0].cmd, '');
  assert.deepEqual(actions[0].args, ['[音乐ID]']);
  assert.equal(actions[0].label, '/music [音乐ID]');
});

test('parseOutput：带 (序号) 占位符的命令也标 needsArg', () => {
  const { actions } = parseOutput(['[肥猫电台]/music cancel (序号) 取消你的点歌[点我选择]']);
  assert.equal(actions[0].needsArg, true);
  assert.equal(actions[0].cmd, 'cancel');
  assert.deepEqual(actions[0].args, ['(序号)']);
});

test('parseOutput：多词子命令拆开', () => {
  const { actions } = parseOutput(['[肥猫电台]/music vote cancel 取消发起的切歌[点我选择]']);
  assert.equal(actions[0].cmd, 'vote');
  assert.deepEqual(actions[0].args, ['cancel']);
  assert.equal(actions[0].label, '/music vote cancel');
});

test('parseOutput：普通文本进 texts', () => {
  const { actions, texts } = parseOutput(['[肥猫电台]正在播放：晴天 - 周杰伦', '队列里还有 3 首']);
  assert.equal(actions.length, 0);
  assert.equal(texts.length, 2);
});

test('parseOutput：空行和纯提示行被丢掉', () => {
  const { actions, texts } = parseOutput(['', '   ', '[点我选择]']);
  assert.equal(actions.length, 0);
  assert.equal(texts.length, 0);
});

test('friendly 翻译常见错误码', () => {
  assert.match(friendly('NO_MUSIC_SESSION'), /没有音乐会话/);
  assert.match(friendly('MUSIC_DISABLED'), /没有开启音乐功能/);
  assert.match(friendly('RATE_LIMITED:太快了'), /太快了/);
  assert.equal(friendly(''), '音乐操作失败');
  assert.equal(friendly('', ['最后一行']), '最后一行');
  assert.equal(friendly('SOMETHING_NEW'), 'SOMETHING_NEW');
});
