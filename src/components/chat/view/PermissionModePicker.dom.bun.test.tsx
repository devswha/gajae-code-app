import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import '../../../i18n/config';
import { defaultProjectPermissions, type PermissionModeUpdate, type ProjectPermissions } from '../../../hooks/useProjectPermissions';

import PermissionModePicker from './PermissionModePicker';

/*
 * Opening the popup, choosing a mode and the bypass confirmation all live in
 * state and effects, which a static render never reaches. This mounts the real
 * picker and drives it the way a user would.
 */

const permissions = (overrides: Partial<ProjectPermissions> = {}): ProjectPermissions => ({
  ...defaultProjectPermissions('project-1'),
  projectPath: '/work/alpha',
  ...overrides,
});

function mount(value: ProjectPermissions) {
  const updates: PermissionModeUpdate[] = [];
  render(createElement(PermissionModePicker, {
    permissions: value,
    onSelectMode: (update: PermissionModeUpdate) => { updates.push(update); },
  }));
  return { updates, trigger: screen.getByRole('button', { name: 'Permission mode' }) };
}

afterEach(cleanup);

test('clicking the trigger lists the three modes with the current one selected', () => {
  const { trigger } = mount(permissions({ mode: 'auto_edits' }));
  assert.equal(trigger.textContent?.includes('Auto-approve edits'), true);

  fireEvent.click(trigger);
  const options = screen.getAllByRole('option');
  assert.deepEqual(options.map((option) => option.getAttribute('data-mode')), ['ask', 'auto_edits', 'bypass']);
  assert.deepEqual(options.map((option) => option.getAttribute('aria-selected')), ['false', 'true', 'false']);
});

test('choosing a non-bypass mode reports it at once and closes the popup', async () => {
  const { updates, trigger } = mount(permissions());
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('option', { name: /Auto-approve edits/ }));

  await waitFor(() => assert.deepEqual(updates, [{ mode: 'auto_edits' }]));
  assert.equal(screen.queryByRole('listbox'), null);
});

test('the first switch to bypass asks for confirmation and only then reports it, acknowledged', async () => {
  const { updates, trigger } = mount(permissions());
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('option', { name: /Bypass/ }));

  const dialog = await screen.findByRole('dialog');
  assert.match(dialog.textContent ?? '', /run any command without asking/);
  assert.deepEqual(updates, [], 'nothing is sent before the user confirms');

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.deepEqual(updates, [], 'cancelling keeps the current mode');

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('option', { name: /Bypass/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Enable bypass' }));
  await waitFor(() => assert.deepEqual(updates, [{ mode: 'bypass', acknowledgeBypass: true }]));
});

test('a project that already acknowledged the warning switches to bypass without a second dialog', async () => {
  const { updates, trigger } = mount(permissions({ bypassAcknowledged: true }));
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('option', { name: /Bypass/ }));

  await waitFor(() => assert.deepEqual(updates, [{ mode: 'bypass' }]));
  assert.equal(screen.queryByRole('dialog'), null);
});

test('Cmd/Ctrl+Shift+P opens the picker from anywhere while it is mounted', () => {
  mount(permissions());
  assert.equal(screen.queryByRole('listbox'), null);

  fireEvent.keyDown(document, { key: 'P', metaKey: true, shiftKey: true });
  assert.ok(screen.getByRole('listbox'));

  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(screen.queryByRole('listbox'), null);
});

test('switching projects dismisses the previous project bypass confirmation', async () => {
  const updates: unknown[] = [];
  const view = render(createElement(PermissionModePicker, {
    permissions: permissions(), onSelectMode: (update) => { updates.push(['a', update]); },
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Permission mode' }));
  fireEvent.click(screen.getByRole('option', { name: /Bypass/ }));
  assert.ok(await screen.findByRole('button', { name: 'Enable bypass' }));
  view.rerender(createElement(PermissionModePicker, {
    permissions: permissions({ projectId: 'project-2' }), onSelectMode: (update) => { updates.push(['b', update]); },
  }));
  assert.equal(screen.queryByRole('dialog'), null, 'a confirmation for A must never enable bypass for B');
  assert.deepEqual(updates, []);
});

test('the keyboard shortcut cannot open the mode picker while a policy write is pending', () => {
  render(createElement(PermissionModePicker, { permissions: permissions(), onSelectMode: () => undefined, busy: true }));
  fireEvent.keyDown(document, { key: 'P', ctrlKey: true, shiftKey: true });
  assert.equal(screen.queryByRole('listbox'), null);
});

test('a failed policy change is reported in the picker and can be retried', async () => {
  render(createElement(PermissionModePicker, {
    permissions: permissions(), onSelectMode: async () => { throw new Error('Permission service unavailable'); },
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Permission mode' }));
  fireEvent.click(screen.getByRole('option', { name: /Auto-approve edits/ }));
  await waitFor(() => assert.match(screen.getByRole('alert').textContent ?? '', /Permission service unavailable/));
  assert.equal((screen.getByRole('button', { name: 'Permission mode' }) as HTMLButtonElement).disabled, false);
});

test('an old policy error stays retired after A to B to A navigation', async () => {
  let rejectUpdate!: (error: Error) => void;
  const view = render(createElement(PermissionModePicker, {
    permissions: permissions(), onSelectMode: () => new Promise((_resolve, reject) => { rejectUpdate = reject; }),
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Permission mode' }));
  fireEvent.click(screen.getByRole('option', { name: /Auto-approve edits/ }));
  view.rerender(createElement(PermissionModePicker, { permissions: permissions({ projectId: 'b' }), onSelectMode: () => undefined }));
  view.rerender(createElement(PermissionModePicker, { permissions: permissions(), onSelectMode: () => undefined }));
  await act(async () => rejectUpdate(new Error('Old failure')));
  assert.equal(screen.queryByRole('alert'), null);
});
