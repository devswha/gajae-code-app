import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pushNavigationPath } from '../PushNavigationBridge';

test('a notification tap navigates to its session or to the root', () => {
  assert.equal(pushNavigationPath({ type: 'notification:navigate', urlPath: '/session/app-session_1:x' }), '/session/app-session_1:x');
  assert.equal(pushNavigationPath({ type: 'notification:navigate', urlPath: '/' }), '/');
});

test('anything else posted by a worker is ignored', () => {
  for (const message of [
    { type: 'notification:navigate', urlPath: 'https://example.com/session/1' },
    { type: 'notification:navigate', urlPath: '/session/../settings' },
    { type: 'notification:navigate', urlPath: '/session/1?next=x' },
    { type: 'notification:navigate', urlPath: '/settings' },
    { type: 'notification:navigate', urlPath: '' },
    { type: 'other', urlPath: '/' },
    { urlPath: '/' },
    'notification:navigate',
    null,
    undefined,
  ]) {
    assert.equal(pushNavigationPath(message), null);
  }
});
