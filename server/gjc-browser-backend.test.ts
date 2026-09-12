import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GJC_BROWSER_BACKEND,
  GJC_ASIDE_UNAVAILABLE_CODE,
  GJC_ASIDE_UNAVAILABLE_MESSAGE,
  GJC_BROWSER_BACKENDS,
  GjcAsideUnavailableError,
  isGjcAsideUnavailableError,
  isGjcBrowserBackend,
} from './gjc-browser-backend.js';

test('Built-in is the default backend and public choices do not expose the runtime setting name', () => {
  assert.equal(DEFAULT_GJC_BROWSER_BACKEND, 'builtin');
  assert.deepEqual([...GJC_BROWSER_BACKENDS], ['builtin', 'aside']);
  assert.equal(isGjcBrowserBackend('builtin'), true);
  assert.equal(isGjcBrowserBackend('aside'), true);
  for (const rejected of ['native', 'Aside', 'puppeteer', '', undefined, null, 1, {}]) {
    assert.equal(isGjcBrowserBackend(rejected), false, JSON.stringify(rejected));
  }
});

test('an unavailable Aside CLI fails with a stable code and fixed text that carries no probe detail', () => {
  const error = new GjcAsideUnavailableError(['/home/someone/.local/bin/aside', 'PATH (aside)']);
  assert.equal(error.code, GJC_ASIDE_UNAVAILABLE_CODE);
  assert.equal(error.code, 'aside_unavailable');
  assert.equal(error.message, GJC_ASIDE_UNAVAILABLE_MESSAGE);
  assert.equal(error.message.includes('/home/someone'), false);
  assert.match(error.message, /Built-in/);
  assert.deepEqual(error.searched, ['/home/someone/.local/bin/aside', 'PATH (aside)']);
  assert.equal(isGjcAsideUnavailableError(error), true);
  assert.equal(isGjcAsideUnavailableError(new Error(GJC_ASIDE_UNAVAILABLE_MESSAGE)), false);
  assert.equal(isGjcAsideUnavailableError({ code: GJC_ASIDE_UNAVAILABLE_CODE }), false);
});
