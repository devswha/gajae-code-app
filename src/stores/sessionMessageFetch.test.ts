import assert from 'node:assert/strict';
import test from 'node:test';

import { REFRESH_RECONCILE_MIN_MESSAGES, buildRefreshMessagesUrl } from './sessionMessageFetch';

test('buildRefreshMessagesUrl always includes a bounded limit (never unbounded)', () => {
  const url = buildRefreshMessagesUrl('sess-1', 0);
  const params = new URL(url, 'http://x').searchParams;
  assert.equal(params.get('limit'), String(REFRESH_RECONCILE_MIN_MESSAGES));
  assert.equal(params.get('offset'), '0');
  assert.ok(url.startsWith('/api/providers/sessions/sess-1/messages?'));
});

test('buildRefreshMessagesUrl never shrinks below the currently-loaded window', () => {
  const url = buildRefreshMessagesUrl('sess-1', 200);
  const params = new URL(url, 'http://x').searchParams;
  assert.equal(params.get('limit'), '200', 'reconcile fetch must cover all loaded/shown messages');
});

test('buildRefreshMessagesUrl floors tiny/invalid loaded counts to the minimum', () => {
  for (const loaded of [5, -3, Number.NaN]) {
    const params = new URL(buildRefreshMessagesUrl('s', loaded as number), 'http://x').searchParams;
    assert.equal(params.get('limit'), String(REFRESH_RECONCILE_MIN_MESSAGES));
  }
});

test('buildRefreshMessagesUrl encodes the session id', () => {
  const url = buildRefreshMessagesUrl('a/b c', 0);
  assert.ok(url.includes('a%2Fb%20c'), 'session id must be URL-encoded');
});
