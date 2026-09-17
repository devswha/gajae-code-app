import assert from 'node:assert/strict';
import test from 'node:test';

import { ComputerUseStore, resolveGjcComputerUse } from './computer-use.js';

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

test('computer use is off until the user turns it on, and a run resolves the stored choice', () => {
  const storage = memoryStorage();
  const store = new ComputerUseStore(storage);
  assert.equal(store.get(), false);
  assert.equal(resolveGjcComputerUse(store), false);
  assert.deepEqual([...storage.values.keys()], [], 'the default is not written; absence means off');

  assert.equal(store.set(true), true);
  assert.equal(store.get(), true);
  assert.equal(resolveGjcComputerUse(store), true);
  assert.deepEqual([...storage.values.entries()], [['automation.computerUse.v1', '1']]);

  assert.equal(store.set(false), false);
  assert.equal(resolveGjcComputerUse(store), false);
});

test('anything but a boolean is refused, and an unrecognised stored value reads as off', () => {
  const store = new ComputerUseStore(memoryStorage({ 'automation.computerUse.v1': 'yes' }));
  assert.equal(store.get(), false);
  for (const value of ['true', 1, null, undefined, {}]) {
    assert.throws(() => store.set(value), /must be true or false/u);
  }
  assert.equal(store.get(), false);
});
