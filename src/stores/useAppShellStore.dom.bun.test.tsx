import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import type { Project } from '../types/app';

import { resetAppShellStore, useAppShellStore } from './useAppShellStore';

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetAppShellStore();
});

test('selector subscribers observe sessions set outside React', () => {
  function SessionSubscriber() {
    const selectedSession = useAppShellStore((state) => state.selectedSession);
    return createElement('output', { 'data-testid': 'session-id' }, selectedSession?.id ?? 'none');
  }

  render(createElement(SessionSubscriber));
  act(() => {
    useAppShellStore.getState().setSelectedSession({ id: 'session-ws', summary: 'Websocket update' });
  });

  assert.equal(screen.getByTestId('session-id').textContent, 'session-ws');
});

test('functional project updates receive the previous value', () => {
  const project = { projectId: 'project-1', displayName: 'Original' } as Project;
  useAppShellStore.getState().setSelectedProject(project);

  let received: Project | null | undefined;
  useAppShellStore.getState().setSelectedProject((previous) => {
    received = previous;
    return previous ? { ...previous, displayName: 'Updated' } : previous;
  });

  assert.equal(received, project);
  assert.equal(useAppShellStore.getState().selectedProject?.displayName, 'Updated');
});

test('sidebarOpen subscribers do not re-render for selectedSession updates', () => {
  let renders = 0;
  function SidebarSubscriber() {
    const sidebarOpen = useAppShellStore((state) => state.sidebarOpen);
    renders += 1;
    return createElement('output', { 'data-testid': 'sidebar-open' }, String(sidebarOpen));
  }

  render(createElement(SidebarSubscriber));
  assert.equal(renders, 1);

  act(() => {
    useAppShellStore.getState().setSelectedSession({ id: 'session-1' });
  });

  assert.equal(renders, 1);
});

test('invalid persisted tabs fall back to chat and tab updates persist', () => {
  localStorage.setItem('activeTab', 'files');
  resetAppShellStore();

  assert.equal(useAppShellStore.getState().activeTab, 'chat');

  useAppShellStore.getState().setActiveTab('tasks');
  assert.equal(localStorage.getItem('activeTab'), 'tasks');
});

test('openSettings defaults to tools and shows the settings modal', () => {
  useAppShellStore.getState().openSettings();

  assert.equal(useAppShellStore.getState().showSettings, true);
  assert.equal(useAppShellStore.getState().settingsInitialTab, 'tools');
});

test('session attention marks and clears only when the set changes', () => {
  const store = useAppShellStore.getState();

  store.markSessionAttention('session-1', null);
  const marked = useAppShellStore.getState().attentionSessionIds;
  assert.deepEqual([...marked], ['session-1']);

  store.markSessionAttention('session-1', null);
  assert.equal(useAppShellStore.getState().attentionSessionIds, marked);

  store.clearSessionAttention('session-1');
  const cleared = useAppShellStore.getState().attentionSessionIds;
  assert.deepEqual([...cleared], []);

  store.clearSessionAttention('session-1');
  assert.equal(useAppShellStore.getState().attentionSessionIds, cleared);
});

test('session attention ignores the currently viewed session', () => {
  useAppShellStore.getState().markSessionAttention('session-1', 'session-1');

  assert.deepEqual([...useAppShellStore.getState().attentionSessionIds], []);
});
