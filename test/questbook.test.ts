import test from 'node:test';
import assert from 'node:assert/strict';
import { normQuestId, questBookUrl, questShareText, QUEST_BOOK_HOME } from '../src/questbook.ts';

// 站点的键是 quest_json.json 里的 quest_id 原文（24 位、带 `==`），少一个字符就查不到
const FULL = 'AAAAAAAAAAAAAAAAAAAF1w==';
const CLIPPED = 'AAAAAAAAAAAAAAAAAAAF1w';

test('服务端截断的 22 位要补回 `==` 填充', () => {
  assert.equal(normQuestId(CLIPPED), FULL);
  // 只被吃掉一个 `=` 的 23 位同样补齐
  assert.equal(normQuestId('AAAAAAAAAAAAAAAAAAAF1w='), FULL);
});

test('完整的 ID 原样通过', () => {
  assert.equal(normQuestId(FULL), FULL);
});

test('粘进来的整句分享标记只取 ID 部分', () => {
  assert.equal(normQuestId(`betterquesting.msg.sharequest:${FULL}`), FULL);
  assert.equal(normQuestId(`  ${FULL}  `), FULL);
  assert.equal(normQuestId(`任务 ${CLIPPED} 看下`), FULL);
});

test('标准 base64 的 +/ 换成 url-safe 的 -/_', () => {
  assert.equal(normQuestId('AAAAAAAAAAAAAAAAAAAF+/'), 'AAAAAAAAAAAAAAAAAAAF-_==');
});

test('认不出来就给空串，不拼打不开的链接', () => {
  for (const bad of [undefined, null, '', '   ', 'abc', '任务ID', '!!!@@@###']) {
    assert.equal(normQuestId(bad), '');
    assert.equal(questBookUrl(bad), null);
  }
});

test('深链是站点唯一认的 ?id= 参数，`=` 要转义', () => {
  assert.equal(questBookUrl(CLIPPED), `${QUEST_BOOK_HOME}?id=AAAAAAAAAAAAAAAAAAAF1w%3D%3D`);
  // URLSearchParams 解回来必须还是带填充的原文
  const url = questBookUrl(CLIPPED)!;
  assert.equal(new URLSearchParams(url.slice(url.indexOf('?'))).get('id'), FULL);
});

test('分享文案带任务名；没名字就只给链接', () => {
  assert.equal(questShareText('长夜漫漫，独身一人', CLIPPED), `长夜漫漫，独身一人 ${questBookUrl(CLIPPED)}`);
  assert.equal(questShareText('  ', CLIPPED), questBookUrl(CLIPPED));
  assert.equal(questShareText('名字', '坏的'), '名字');
});
