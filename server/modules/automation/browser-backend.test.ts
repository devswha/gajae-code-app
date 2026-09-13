import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBackendStore, resolveGjcBrowserBackend } from './browser-backend.js';

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

test('Built-in is the backend until the user explicitly chooses Aside, and a run resolves the stored choice', () => {
  const storage = memoryStorage();
  const store = new BrowserBackendStore(storage);
  assert.equal(store.get(), 'builtin');
  assert.equal(resolveGjcBrowserBackend(store), 'builtin');

  assert.equal(store.set('aside'), 'aside');
  assert.equal(store.get(), 'aside');
  assert.equal(resolveGjcBrowserBackend(store), 'aside');
  assert.deepEqual([...storage.values.keys()], ['automation.browserBackend.v1']);

  assert.equal(store.set('ego'), 'ego');
  assert.equal(resolveGjcBrowserBackend(store), 'ego');

  // Switching back restores the default without leaving Aside or ego state behind.
  assert.equal(store.set('builtin'), 'builtin');
  assert.equal(resolveGjcBrowserBackend(store), 'builtin');
});

test('legacy native reads as Built-in without rewriting config; unknown values read as Built-in and cannot be written', () => {
  const legacyStorage = memoryStorage({ 'automation.browserBackend.v1': 'native' });
  const legacy = new BrowserBackendStore(legacyStorage);
  assert.equal(legacy.get(), 'builtin');
  assert.equal(legacyStorage.values.get('automation.browserBackend.v1'), 'native');
  const store = new BrowserBackendStore(memoryStorage({ 'automation.browserBackend.v1': 'puppeteer' }));
  assert.equal(store.get(), 'builtin');
  for (const rejected of ['native', 'Aside', 'ASIDE', 'Ego', 'ego-lite', '', undefined, null, 1, { backend: 'aside' }]) {
    assert.throws(() => store.set(rejected), /Browser backend must be one of builtin, aside, ego/, JSON.stringify(rejected));
  }
  assert.equal(store.get(), 'builtin');
});
