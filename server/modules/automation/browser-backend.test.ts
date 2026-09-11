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

test('native is the backend until the user explicitly chooses Aside, and a run resolves the stored choice', () => {
  const storage = memoryStorage();
  const store = new BrowserBackendStore(storage);
  assert.equal(store.get(), 'native');
  assert.equal(resolveGjcBrowserBackend(store), 'native');

  assert.equal(store.set('aside'), 'aside');
  assert.equal(store.get(), 'aside');
  assert.equal(resolveGjcBrowserBackend(store), 'aside');
  assert.deepEqual([...storage.values.keys()], ['automation.browserBackend.v1']);

  // Switching back restores the default without leaving Aside state behind.
  assert.equal(store.set('native'), 'native');
  assert.equal(resolveGjcBrowserBackend(store), 'native');
});

test('an unknown or damaged stored value reads as native and cannot be written', () => {
  const store = new BrowserBackendStore(memoryStorage({ 'automation.browserBackend.v1': 'puppeteer' }));
  assert.equal(store.get(), 'native');
  for (const rejected of ['Aside', 'ASIDE', '', undefined, null, 1, { backend: 'aside' }]) {
    assert.throws(() => store.set(rejected), /Browser backend must be one of native, aside/, JSON.stringify(rejected));
  }
  assert.equal(store.get(), 'native');
});
