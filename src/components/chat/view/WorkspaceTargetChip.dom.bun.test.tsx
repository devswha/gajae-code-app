import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import '../../../i18n/config';
import type { WorkspaceCandidate } from '../hooks/useWorkspaceTarget';

import WorkspaceTargetChip from './WorkspaceTargetChip';

/*
 * The chip is the only visible surface of workspace-quick-task, so its two
 * states - resolved target vs. still-at-root - and the picker it opens are
 * what a user actually interacts with. A static render never opens the
 * picker, so this mounts the real component.
 */

const candidate = (overrides: Partial<WorkspaceCandidate> = {}): WorkspaceCandidate => ({
  path: '/Projects/gajae-code-app',
  name: 'gajae-code-app',
  score: 100,
  reason: 'mention',
  ...overrides,
});

afterEach(cleanup);

test('no target shows the workspace root name with a choose-repo affordance', () => {
  render(createElement(WorkspaceTargetChip, {
    workspaceRootName: 'Projects',
    candidates: [candidate()],
    target: null,
    onPick: () => {},
  }));

  const trigger = screen.getByRole('button');
  assert.match(trigger.textContent ?? '', /Projects/);
  assert.match(trigger.textContent ?? '', /choose repo/);
});

test('a resolved target shows the arrow label instead of the root name', () => {
  render(createElement(WorkspaceTargetChip, {
    workspaceRootName: 'Projects',
    candidates: [candidate()],
    target: candidate(),
    onPick: () => {},
  }));

  const trigger = screen.getByRole('button');
  assert.match(trigger.textContent ?? '', /→ gajae-code-app/);
  assert.equal(screen.queryByText(/choose repo/), null);
});

test('opening the picker lists every candidate plus keep at root, and choosing one calls back', () => {
  const picks: Array<WorkspaceCandidate | null> = [];
  render(createElement(WorkspaceTargetChip, {
    workspaceRootName: 'Projects',
    candidates: [candidate(), candidate({ path: '/Projects/other-app', name: 'other-app', score: 40, reason: 'partial' })],
    target: null,
    onPick: (picked) => picks.push(picked),
  }));

  fireEvent.click(screen.getByRole('button', { name: /choose repo/ }));
  assert.ok(screen.getByRole('option', { name: /gajae-code-app/ }));
  assert.ok(screen.getByRole('option', { name: /other-app/ }));
  assert.ok(screen.getByRole('option', { name: 'Keep at root' }));

  fireEvent.click(screen.getByRole('option', { name: /other-app/ }));
  assert.deepEqual(picks, [candidate({ path: '/Projects/other-app', name: 'other-app', score: 40, reason: 'partial' })]);
  // Picking closes the popup.
  assert.equal(screen.queryByRole('listbox'), null);
});

test('the picker filters by name and Enter picks the first match', () => {
  const picks: Array<WorkspaceCandidate | null> = [];
  render(createElement(WorkspaceTargetChip, {
    workspaceRootName: 'Projects',
    candidates: [
      candidate({ path: '/Projects/hf-studio', name: 'hf-studio', score: 0, reason: 'recent' }),
      candidate({ path: '/Projects/moss-hq', name: 'moss-hq', score: 0, reason: 'recent' }),
      candidate({ path: '/Projects/moss-companion', name: 'moss-companion', score: 0, reason: 'recent' }),
    ],
    target: null,
    onPick: (picked) => picks.push(picked),
  }));

  fireEvent.click(screen.getByRole('button', { name: /choose repo/ }));
  const search = screen.getByRole('textbox', { name: /Search repos/ });
  fireEvent.change(search, { target: { value: 'MOSS' } });
  assert.equal(screen.queryByRole('option', { name: /hf-studio/ }), null);
  assert.ok(screen.getByRole('option', { name: /moss-hq/ }));
  assert.ok(screen.getByRole('option', { name: /moss-companion/ }));

  fireEvent.change(search, { target: { value: 'zzz' } });
  assert.ok(screen.getByText('No repo matches'));

  fireEvent.change(search, { target: { value: 'moss-c' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  assert.deepEqual(picks.map((pick) => pick?.name), ['moss-companion']);
});

test('choosing keep at root reports a null target', () => {
  const picks: Array<WorkspaceCandidate | null> = [];
  render(createElement(WorkspaceTargetChip, {
    workspaceRootName: 'Projects',
    candidates: [candidate()],
    target: candidate(),
    onPick: (picked) => picks.push(picked),
  }));

  fireEvent.click(screen.getByRole('button', { name: /gajae-code-app/ }));
  fireEvent.click(screen.getByRole('option', { name: 'Keep at root' }));

  assert.deepEqual(picks, [null]);
});
