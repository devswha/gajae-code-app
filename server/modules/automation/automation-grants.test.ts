import assert from 'node:assert/strict';
import test from 'node:test';

import { AutomationGrantStore } from './automation-grants.js';

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
  };
}

test('session grants are isolated and cleared without touching always grants', () => {
  const store = new AutomationGrantStore(memoryStorage());
  store.grant({ kind: 'origin', value: 'https://example.com', scope: 'always' });
  store.grant({ kind: 'application', value: 'com.apple.TextEdit', scope: 'session', sessionId: 'session-a' });

  assert.equal(store.has('origin', 'https://example.com', 'session-b'), true);
  assert.equal(store.has('application', 'com.apple.TextEdit', 'session-a'), true);
  assert.equal(store.has('application', 'com.apple.TextEdit', 'session-b'), false);

  store.clearSession('session-a');
  assert.equal(store.has('application', 'com.apple.TextEdit', 'session-a'), false);
  assert.equal(store.has('origin', 'https://example.com', 'session-a'), true);
});
test('persisted grants are normalized and individually revocable', () => {
  const storage = memoryStorage({
    'automation.grants.v1': JSON.stringify({ origins: ['https://b.test', 'https://b.test', 42], applications: ['com.example.App'] }),
  });
  const store = new AutomationGrantStore(storage);

  assert.deepEqual(store.list().always.origins, ['https://b.test']);
  store.revoke({ kind: 'application', value: 'com.example.App', scope: 'always' });
  assert.deepEqual(store.list().always.applications, []);
});
