import assert from 'node:assert/strict';
import test from 'node:test';

import { SESSION_TITLE_MAX_LENGTH, deriveSessionTitle } from '@/shared/utils.js';

const title = (raw: string | undefined, maxLength?: number) => deriveSessionTitle(raw, 'Untitled', maxLength);

test('a short plain request is kept as written, with a capital and no trailing punctuation', () => {
  assert.equal(title('Add a gjc provider'), 'Add a gjc provider');
  assert.equal(title('fix the pagination bug.'), 'Fix the pagination bug');
  assert.equal(title('  why   does   this  fail?  '), 'Why does this fail');
});

test('the title never exceeds the limit and prefers a word boundary before adding an ellipsis', () => {
  const long = 'Refactor the websocket reconnect handling so that background sessions keep their replay cursor';
  const result = title(long);
  assert.ok(result.length <= SESSION_TITLE_MAX_LENGTH, `${result.length} chars`);
  assert.equal(result, 'Refactor the websocket reconnect…');

  const custom = title(long, 20);
  assert.ok(custom.length <= 20);
  assert.equal(custom, 'Refactor the…');
});

test('unbroken text is cut hard rather than dropped', () => {
  const hangul = '사이드바에서세션상태를네가지로나누고읽지않은완료상태를따로표시하도록바꿔주세요그리고검색도추가';
  const result = title(hangul);
  assert.equal(result.length, SESSION_TITLE_MAX_LENGTH);
  assert.ok(result.endsWith('…'));
  assert.ok(hangul.startsWith(result.slice(0, -1)));
});

test('the first sentence becomes the title when it says enough on its own', () => {
  assert.equal(title('Fix the login redirect loop. It happens after the OAuth callback when the state param is stale.'), 'Fix the login redirect loop');
  assert.equal(title('로그인 리다이렉트 루프를 고쳐 주세요。 OAuth 콜백 이후에 발생합니다.'), '로그인 리다이렉트 루프를 고쳐 주세요');
  // A one-word opener is not a title; the sentence rule needs substance.
  assert.equal(title('Hi. Please fix the login bug'), 'Hi. Please fix the login bug');
  // Dots inside versions and abbreviations are not boundaries.
  assert.equal(title('Upgrade to v2.0 e.g. by bumping the manifest'), 'Upgrade to v2.0 e.g. by bumping the…');
});

test('slash commands, mentions and code are not what the conversation is about', () => {
  assert.equal(title('/plan add retry logic to the webhook sender'), 'Add retry logic to the webhook sender');
  assert.equal(title('@src/server/index.ts @README.md explain the boot order'), 'Explain the boot order');
  assert.equal(title('Why does this throw?\n```ts\nconst x = JSON.parse(undefined);\n```\nIt worked yesterday.'), 'Why does this throw');
  assert.equal(title('Rename `useFoo` to `useBar` everywhere'), 'Rename useFoo to useBar everywhere');
  assert.equal(title('Ping user@example.com about the /api/users route'), 'Ping user@example.com about the…');
});

test('markdown dressing is removed before measuring', () => {
  assert.equal(title('## Plan\n- **Bold** step one\n> quoted'), 'Plan Bold step one quoted');
  assert.equal(title('See [the docs](https://example.com/docs) for the flag'), 'See the docs for the flag');
  assert.equal(title('<user-message>\nhello there\n</user-message>'), 'Hello there');
});

test('a message that was only a command is titled by the command', () => {
  assert.equal(title('/init'), 'Init');
  assert.equal(title('/ulw-loop'), 'Ulw loop');
  assert.equal(title('/review:security  '), 'Review security');
});

test('nothing usable falls back to the caller\'s default', () => {
  assert.equal(title(undefined), 'Untitled');
  assert.equal(title(''), 'Untitled');
  assert.equal(title('   \n  '), 'Untitled');
  assert.equal(title('```\nonly code\n```'), 'Untitled');
  assert.equal(title('...'), 'Untitled');
});
