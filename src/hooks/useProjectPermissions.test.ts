import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PERMISSION_MODE, defaultProjectPermissions, isPermissionMode } from './useProjectPermissions';

test('only the three modes are modes', () => {
  for (const mode of ['ask', 'auto_edits', 'bypass']) assert.equal(isPermissionMode(mode), true, mode);
  for (const other of ['default', 'allow', '', undefined, 1]) assert.equal(isPermissionMode(other), false, String(other));
});

test('a project starts in bypass, as the GJC CLI runs its tools without asking', () => {
  assert.equal(DEFAULT_PERMISSION_MODE, 'bypass');
  assert.deepEqual(defaultProjectPermissions('p'), { projectId: 'p', projectPath: '', mode: 'bypass', allowAlways: [], updatedAt: null });
});
