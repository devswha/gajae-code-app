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
