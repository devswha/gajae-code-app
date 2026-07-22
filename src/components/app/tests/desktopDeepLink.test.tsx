import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deepLinkPath } from '../DesktopDeepLinkBridge';

test('gajae-app job deep links return to the root shell', () => {
  assert.equal(deepLinkPath('gajae-app://open/job/job-7fb9426de036'), '/');
});

test('foreign schemes, malformed urls, and unknown shapes are rejected', () => {
  for (const raw of [
    'https://example.com/open/job/job-1',
    'gajae-app://open/session/whatever',
    'gajae-app://open/job/',
    'gajae-app://open/job/../../etc',
    'gajae-app://other/job/job-1',
    'not a url',
    42,
    null,
    undefined,
  ]) {
    assert.equal(deepLinkPath(raw), null);
  }
});
