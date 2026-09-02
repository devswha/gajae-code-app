import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';

import type { SessionStore } from '../../../stores/useSessionStore';
import type { ProjectChange } from '../hooks/useProjectChanges';

import WorkspaceChangesTab, { ChangeRow } from './WorkspaceChangesTab';

const t = (key: string) => key;
const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } });
const file: ProjectChange = {
  path: 'src/file.ts',
  oldPath: null,
  status: 'modified',
  staged: false,
  additions: 1,
  deletions: 1,
  patch: '@@ -1,2 +1,2 @@\n-old\n+new\n keep',
  binary: false,
  tooLarge: false,
  patchOmitted: false,
};

afterEach(cleanup);

test('switching comment rows clears the prior row draft and focuses the new editor', () => {
  render(createElement(I18nextProvider, { i18n }, createElement(ChangeRow, {
    file,
    openPath: file.path,
    onSetOpenPath: () => {},
    onOpenInEditor: () => {},
    onComposerInsert: () => true,
    t,
  })));

  const actions = screen.getAllByLabelText('workspace.changes.comment.add');
  fireEvent.click(actions[0]);
  const firstInput = screen.getByLabelText('workspace.changes.comment.placeholder') as HTMLInputElement;
  fireEvent.change(firstInput, { target: { value: 'old draft' } });

  fireEvent.click(actions[1]);
  const nextInput = screen.getByLabelText('workspace.changes.comment.placeholder') as HTMLInputElement;
  assert.equal(nextInput.value, '');
  assert.equal(document.activeElement, nextInput);
});

test('an unavailable composer keeps the line comment draft instead of discarding it', () => {
  render(createElement(I18nextProvider, { i18n }, createElement(ChangeRow, {
    file,
    openPath: file.path,
    onSetOpenPath: () => {},
    onOpenInEditor: () => {},
    onComposerInsert: () => false,
    t,
  })));

  fireEvent.click(screen.getAllByLabelText('workspace.changes.comment.add')[0]);
  const input = screen.getByLabelText('workspace.changes.comment.placeholder') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'keep me' } });
  fireEvent.click(screen.getByLabelText('workspace.changes.comment.send'));

  assert.equal(screen.getByLabelText('workspace.changes.comment.placeholder'), input);
  assert.equal(input.value, 'keep me');
});

test('an orphaned mutation is not shown as loading after the run is idle', () => {
  const messages = [
    { id: 'user', sessionId: 'session', timestamp: '2026-01-01T00:00:00Z', provider: 'gjc', kind: 'text', role: 'user', content: 'edit it' },
    { id: 'edit', sessionId: 'session', timestamp: '2026-01-01T00:00:01Z', provider: 'gjc', kind: 'tool_use', toolId: 'edit-1', toolName: 'edit', toolInput: { path: 'file.ts', edits: [] } },
  ];
  const sessionStore = {
    getMessages: () => messages,
    getSessionSlot: () => ({ status: 'idle' }),
  } as unknown as SessionStore;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(createElement(QueryClientProvider, { client: queryClient },
    createElement(I18nextProvider, { i18n },
      createElement(WorkspaceChangesTab, {
        projectId: 'project',
        projectPath: '/tmp/project',
        sessionId: 'session',
        sessionStore,
        lastTurnRunning: false,
        active: true,
      }),
    ),
  ));
  fireEvent.click(screen.getByRole('button', { name: 'workspace.changes.scope.lastTurn' }));

  assert.ok(screen.getByText('workspace.changes.emptyTurn'));
  assert.equal(screen.queryByText('workspace.changes.loading'), null);
});
