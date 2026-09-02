import assert from 'node:assert/strict';
import test from 'node:test';

import { offeredPermissionKinds, permissionResponseMessage } from './chatPermissions';

test('permission responses preserve always for both allow and deny decisions', () => {
  assert.deepEqual(permissionResponseMessage('allow-1', { allow: true, always: true }), {
    type: 'chat.permission-response',
    requestId: 'allow-1',
    allow: true,
    always: true,
    updatedInput: undefined,
    message: undefined,
  });
  assert.deepEqual(permissionResponseMessage('deny-1', { allow: false, always: true, message: 'denied for this run' }), {
    type: 'chat.permission-response',
    requestId: 'deny-1',
    allow: false,
    always: true,
    updatedInput: undefined,
    message: 'denied for this run',
  });
});

test('permission responses omit always for one-time decisions', () => {
  assert.equal('always' in permissionResponseMessage('deny-once', { allow: false }), false);
  assert.deepEqual([...offeredPermissionKinds({ options: ['allow_once', 'reject_always'] })!], ['allow_once', 'reject_always']);
});
