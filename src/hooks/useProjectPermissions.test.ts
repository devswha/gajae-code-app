import assert from 'node:assert/strict';
import test from 'node:test';

import { isPermissionMode, takeLegacySkipPermissions } from './useProjectPermissions';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
}

/*
 * The old tools-settings blob carried a hidden `skipPermissions` flag with no
 * UI. It is read exactly once, turned into the project's bypass mode, and
 * removed, so nothing can keep honouring a setting the user can no longer see.
 */

test('a set flag is consumed and the rest of the blob survives', () => {
  const storage = new MemoryStorage();
  storage.setItem('gjc-tools-settings', JSON.stringify({ allowedTools: ['bash'], skipPermissions: true }));

  assert.equal(takeLegacySkipPermissions(storage), true);
  assert.deepEqual(JSON.parse(storage.getItem('gjc-tools-settings') ?? '{}'), { allowedTools: ['bash'] });
  assert.equal(takeLegacySkipPermissions(storage), false, 'the second read finds nothing to migrate');
});

test('an unset flag is cleared without turning into bypass', () => {
  const storage = new MemoryStorage();
  storage.setItem('gjc-tools-settings', JSON.stringify({ skipPermissions: false }));

  assert.equal(takeLegacySkipPermissions(storage), false);
  assert.equal(storage.getItem('gjc-tools-settings'), null, 'an otherwise empty blob is removed');
});

test('missing or malformed storage is not a migration', () => {
  assert.equal(takeLegacySkipPermissions(new MemoryStorage()), false);
  assert.equal(takeLegacySkipPermissions(null), false);

  const broken = new MemoryStorage();
  broken.setItem('gjc-tools-settings', '{not json');
  assert.equal(takeLegacySkipPermissions(broken), false);
  assert.equal(broken.getItem('gjc-tools-settings'), '{not json', 'unparseable data is left alone');
});

test('only the three modes are modes', () => {
  for (const mode of ['ask', 'auto_edits', 'bypass']) assert.equal(isPermissionMode(mode), true, mode);
  for (const other of ['default', 'allow', '', undefined, 1]) assert.equal(isPermissionMode(other), false, String(other));
});
