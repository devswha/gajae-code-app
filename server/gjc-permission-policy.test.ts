import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GJC_AUTO_EDIT_TOOLS,
  gjcAutoApprovalNotice,
  gjcAutoApprovalReason,
  isGjcPermissionToolName,
  parseGjcRunPermissions,
} from './gjc-permission-policy.js';

test('an absent permissions block leaves the runtime default in place', () => {
  assert.equal(parseGjcRunPermissions(undefined), undefined);
});

test('a permissions block is validated field by field', () => {
  assert.deepEqual(
    parseGjcRunPermissions({ mode: 'ask', allowAlways: ['bash', 'bash', 'eval'] }),
    { mode: 'ask', allowAlways: ['bash', 'eval'] },
  );
  assert.deepEqual(parseGjcRunPermissions({ mode: 'bypass' }), { mode: 'bypass', allowAlways: [] });

  for (const malformed of [
    null,
    'ask',
    { mode: 'yolo' },
    { mode: 'ask', allowAlways: 'bash' },
    { mode: 'ask', allowAlways: ['Bash'] },
    { mode: 'ask', allowAlways: ['rm -rf'] },
    { mode: 'ask', allowAlways: [], extra: true },
  ]) {
    assert.throws(() => parseGjcRunPermissions(malformed), /Invalid GJC run permissions/, JSON.stringify(malformed));
  }
});

test('tool names are the runtime\'s own lowercase identifiers', () => {
  for (const valid of ['bash', 'edit', 'todo_write', 'ast-edit']) assert.equal(isGjcPermissionToolName(valid), true, valid);
  for (const invalid of ['', 'Bash', '1tool', 'a'.repeat(65), 'rm -rf', 42]) assert.equal(isGjcPermissionToolName(invalid), false, String(invalid));
});

test('ask mode approves nothing on its own', () => {
  const ask = { mode: 'ask' as const, allowAlways: [] };
  for (const tool of ['bash', 'edit', 'delete', 'eval']) assert.equal(gjcAutoApprovalReason(ask, tool), null, tool);
});

test('the allow-list approves exactly the tools it names', () => {
  const policy = { mode: 'ask' as const, allowAlways: ['bash'] };
  assert.equal(gjcAutoApprovalReason(policy, 'bash'), 'always_allow');
  assert.equal(gjcAutoApprovalReason(policy, 'eval'), null);
});

test('auto_edits approves file mutations and still asks for execution', () => {
  const policy = { mode: 'auto_edits' as const, allowAlways: [] };
  for (const tool of GJC_AUTO_EDIT_TOOLS) assert.equal(gjcAutoApprovalReason(policy, tool), 'auto_edits', tool);
  for (const tool of ['bash', 'monitor', 'eval']) assert.equal(gjcAutoApprovalReason(policy, tool), null, tool);
});

test('bypass approves everything and is named as the reason over the allow-list', () => {
  const policy = { mode: 'bypass' as const, allowAlways: ['bash'] };
  assert.equal(gjcAutoApprovalReason(policy, 'bash'), 'bypass');
  assert.equal(gjcAutoApprovalReason(policy, 'eval'), 'bypass');
});

test('the transcript notice names the tool and the reason', () => {
  assert.equal(gjcAutoApprovalNotice('bash', 'always_allow'), 'Auto-approved bash (always allow)');
  assert.equal(gjcAutoApprovalNotice('eval', 'bypass'), 'Auto-approved eval (bypass)');
  assert.equal(gjcAutoApprovalNotice('delete', 'auto_edits'), 'Auto-approved delete (auto-approve edits)');
});
