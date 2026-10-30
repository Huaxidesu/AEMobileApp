import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_MODULES,
  MUSIC_COMMANDS,
  commandArgs,
  commandQuery,
  commandText,
  filterCommands,
  mergeCandidates,
  parseOutgoing,
  trailingMention,
} from '../src/commands.ts';

test('普通文本走聊天', () => {
  assert.deepEqual(parseOutgoing('晚上开荒，谁来？'), { kind: 'chat', text: '晚上开荒，谁来？' });
});

test('空输入返回 null', () => {
  assert.equal(parseOutgoing('   '), null);
});

test('/music 前缀被拆成子命令', () => {
  assert.deepEqual(parseOutgoing('/music search 晴天'), { kind: 'music', cmd: 'search', args: ['晴天'] });
  assert.deepEqual(parseOutgoing('/music list'), { kind: 'music', cmd: 'list', args: [] });
});

test('@allmusic 前缀同样走音乐，带不带 /music 都行', () => {
  assert.deepEqual(parseOutgoing('@allmusic /music search 晴天'), { kind: 'music', cmd: 'search', args: ['晴天'] });
  assert.deepEqual(parseOutgoing('@allmusic search 晴天'), { kind: 'music', cmd: 'search', args: ['晴天'] });
  assert.deepEqual(parseOutgoing('@AllMusic list'), { kind: 'music', cmd: 'list', args: [] });
});

test('只发 @allmusic 等于 help', () => {
  assert.deepEqual(parseOutgoing('@allmusic'), { kind: 'music', cmd: '', args: [] });
});

test('@allmusic 开头的普通句子也走音乐（不会误刷公屏）', () => {
  assert.deepEqual(parseOutgoing('@allmusic 来首歌'), { kind: 'music', cmd: '来首歌', args: [] });
});

test('其它斜杠命令标记为 unknown，不发到公屏', () => {
  assert.deepEqual(parseOutgoing('/stop'), { kind: 'unknown', raw: '/stop' });
  assert.deepEqual(parseOutgoing('/home'), { kind: 'unknown', raw: '/home' });
});

test('@玩家 开头的文本仍然是聊天', () => {
  assert.deepEqual(parseOutgoing('@老王 你来一下'), { kind: 'chat', text: '@老王 你来一下' });
});

test('commandText 带占位参数，commandArgs 给执行参数', () => {
  const search = MUSIC_COMMANDS.find((c) => c.label === 'search')!;
  assert.equal(commandText(search), '@allmusic /music search [歌名] ');
  assert.deepEqual(commandArgs(search), { cmd: 'search', args: [] });

  const voteCancel = MUSIC_COMMANDS.find((c) => c.label === 'vote cancel')!;
  assert.equal(commandText(voteCancel), '@allmusic /music vote cancel');
  assert.deepEqual(commandArgs(voteCancel), { cmd: 'vote', args: ['cancel'] });
});

test('filterCommands 按关键字过滤', () => {
  assert.ok(filterCommands('sea').some((c) => c.label === 'search'));
  assert.equal(filterCommands('不存在的命令').length, 0);
  assert.equal(filterCommands('').length, MUSIC_COMMANDS.length);
});

test('trailingMention 认出没写完的 @', () => {
  assert.deepEqual(trailingMention('你好 @老'), { start: 3, word: '老' });
  assert.deepEqual(trailingMention('@'), { start: 0, word: '' });
  assert.equal(trailingMention('没有提及'), null);
  assert.equal(trailingMention('@老王 你好'), null);
});

test('commandQuery 只在命令模式下返回值', () => {
  assert.equal(commandQuery('/'), '');
  assert.equal(commandQuery('/mus'), 'mus');
  assert.equal(commandQuery('@allmusic sea'), 'sea');
  assert.equal(commandQuery('@allmusic /music list'), 'list');
  assert.equal(commandQuery('普通聊天'), null);
  assert.equal(commandQuery('@老王 你好'), null);
});

test('mergeCandidates 去重且大小写不敏感，AllMusic 不混进玩家列表', () => {
  assert.deepEqual(mergeCandidates(['Steve', 'Alex'], ['alex', '老王']), ['Steve', 'Alex', '老王']);
  assert.equal(mergeCandidates([], [], 20).length, 0);
});

test('模块表里的前缀能直接进命令面板', () => {
  for (const m of CHAT_MODULES) {
    assert.ok(m.prefix.startsWith('@allmusic'), `${m.id} 的前缀应当是 @allmusic`);
    assert.equal(commandQuery(m.prefix), '', `${m.id} 选完应当进入命令模式`);
  }
});
