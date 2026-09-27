import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import '../../../i18n/config';
import type { PermissionDecision } from '../types/types';

import PermissionRequestsBanner from './PermissionRequestsBanner';

afterEach(cleanup);

function mount() {
  const decisions: Array<[string | string[], PermissionDecision]> = [];
  render(createElement(PermissionRequestsBanner, {
    pendingPermissionRequests: [{
      requestId: 'sdk-permission:1',
      toolName: 'bash',
      input: { command: 'npm test' },
      context: { source: 'sdk-permission', title: 'npm test' },
    }],
    handlePermissionDecision: (ids, decision) => { decisions.push([ids, decision]); },
  }));
  return decisions;
}

test('Allow answers once, without remembering anything', () => {
  const decisions = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
  assert.deepEqual(decisions, [['sdk-permission:1', { allow: true }]]);
});

test('Always allow answers with the remembered flag for this tool', () => {
  const decisions = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Always allow bash' }));
  assert.deepEqual(decisions, [['sdk-permission:1', { allow: true, always: true }]]);
});

test('Deny refuses the call', () => {
  const decisions = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0][1].allow, false);
  assert.equal(decisions[0][1].always, undefined);
});

function mountWithOptions(contextOptions: string[] | null) {
  // One test mounts several variants; the previous container must go or its
  // buttons answer for the wrong one.
  cleanup();
  const decisions: Array<[string | string[], PermissionDecision]> = [];
  render(createElement(PermissionRequestsBanner, {
    pendingPermissionRequests: [{
      requestId: 'sdk-permission:2',
      toolName: 'bash',
      input: { command: 'npm test' },
      ...(contextOptions ? { context: { source: 'sdk-permission', title: 'npm test', options: contextOptions } } : { context: { source: 'sdk-permission', title: 'npm test' } }),
    }],
    handlePermissionDecision: (ids, decision) => { decisions.push([ids, decision]); },
  }));
  return decisions;
}

test('Always deny appears only when the runtime offered reject_always, and refuses with the remembered flag', () => {
  // Offered: the button answers { allow: false, always: true }.
  const decisions = mountWithOptions(['allow_once', 'allow_always', 'reject_once', 'reject_always']);
  fireEvent.click(screen.getByRole('button', { name: 'Always deny bash' }));
  assert.deepEqual(decisions, [['sdk-permission:2', { allow: false, always: true, message: 'User denied tool use (always)' }]]);

  // Not offered: no button, the plain Deny carries no always flag.
  const plain = mountWithOptions(['allow_once', 'allow_always', 'reject_once']);
  assert.equal(screen.queryByRole('button', { name: /Always deny/ }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
  assert.equal(plain[0][1].always, undefined);

  // No options statement at all: the card keeps its historical set - always
  // allow without always deny.
  mountWithOptions(null);
  assert.equal(screen.queryByRole('button', { name: /Always deny/ }), null);
  assert.ok(screen.getByRole('button', { name: 'Always allow bash' }));
});

test('Cmd/Ctrl+Enter approves the waiting card once', () => {
  const decisions = mount();
  fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true });
  assert.deepEqual(decisions, [['sdk-permission:1', { allow: true }]]);

  fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(document.body, { key: 'Enter' });
  assert.equal(decisions.length, 1, 'only the exact chord approves');
});

test('the chord in a text field stays with the field: a draft never becomes an approval', () => {
  const decisions = mount();
  const draft = document.createElement('textarea');
  document.body.append(draft);
  try {
    fireEvent.keyDown(draft, { key: 'Enter', metaKey: true });
    assert.equal(decisions.length, 0);
  } finally {
    draft.remove();
  }
});

test('the full command is shown, not truncated to one line', () => {
  mount();
  const command = screen.getByText('npm test', { selector: 'code' });
  assert.equal(command.classList.contains('truncate'), false);
  assert.ok(command.classList.contains('whitespace-pre-wrap'));
});
