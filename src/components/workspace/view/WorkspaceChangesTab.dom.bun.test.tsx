import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';

import type { SessionStore } from '../../../stores/useSessionStore';
import type { ProjectChange, ProjectChanges } from '../hooks/useProjectChanges';

import WorkspaceChangesTab, { ChangeRow } from './WorkspaceChangesTab';

const t = (key: string) => key;
const rowShared = { openPath: null as string | null, onSetOpenPath: () => {}, onOpenInEditor: () => {}, review: [], onCommentChange: () => {}, onSendReview: () => true, t };
const i18n = createInstance();
// Only the review's send label is translated, so its count is observable;
// every other key renders as itself.
await i18n.init({ lng: 'en', resources: { en: { translation: { workspace: { changes: { review: { send_one: 'send:{{count}}', send_other: 'send:{{count}}' } } } } } } });
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
    ...rowShared,
    file,
    openPath: file.path,
    onComposerInsert: () => true,
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

function renderTab(files: ProjectChange[], onComposerInsert: (text: string) => boolean) {
  const changes: ProjectChanges = { branch: 'main', hasCommits: true, files, totalFiles: files.length, truncated: false };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(changes), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(createElement(QueryClientProvider, { client: queryClient },
    createElement(I18nextProvider, { i18n },
      createElement(WorkspaceChangesTab, {
        projectId: 'project',
        projectPath: '/tmp/project',
        sessionStore: { getMessages: () => [], getSessionSlot: () => ({ status: 'idle' }), subscribeSession: () => () => {} } as unknown as SessionStore,
        onComposerInsert,
        active: true,
      }),
    ),
  ));
  return () => { globalThis.fetch = originalFetch; };
}

async function addComment(rowIndex: number, text: string) {
  fireEvent.click(screen.getAllByLabelText('workspace.changes.comment.add')[rowIndex]);
  const input = screen.getByLabelText('workspace.changes.comment.placeholder') as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

test('comments across files accumulate into one review and are sent as a single message', async () => {
  const inserted: string[] = [];
  const other: ProjectChange = { ...file, path: 'src/other.ts', patch: '@@ -1 +1 @@\n-before\n+after' };
  const restore = renderTab([file, other], (text) => { inserted.push(text); return true; });
  try {
    fireEvent.click(await screen.findByText('src/file.ts'));
    await addComment(1, 'why new');
    assert.equal(screen.getByText('send:1').tagName, 'BUTTON');
    assert.ok(screen.getByText('why new'));

    fireEvent.click(screen.getByText('src/other.ts'));
    await addComment(1, 'why after');
    assert.ok(screen.getByText('send:2'));
    // Re-expanding the first file shows its comment still waiting.
    fireEvent.click(screen.getByText('src/file.ts'));
    assert.ok(screen.getByText('why new'));

    fireEvent.click(screen.getByText('send:2'));
    assert.deepEqual(inserted, ['why new\n\nsrc/file.ts:1\n> +new\n\nwhy after\n\nsrc/other.ts:1\n> +after']);
    assert.equal(screen.queryByText(/^send:/), null);
    assert.equal(screen.queryByText('why new'), null);
  } finally {
    restore();
  }
});

test('a pending comment can be edited in place or removed, and Cmd+Enter sends the review', async () => {
  const inserted: string[] = [];
  const restore = renderTab([file], (text) => { inserted.push(text); return true; });
  try {
    fireEvent.click(await screen.findByText('src/file.ts'));
    await addComment(1, 'first take');
    await addComment(0, 'about old');
    assert.ok(screen.getByText('send:2'));

    fireEvent.click(screen.getByText('first take'));
    const editor = screen.getByLabelText('workspace.changes.comment.placeholder') as HTMLInputElement;
    assert.equal(editor.value, 'first take');
    fireEvent.change(editor, { target: { value: 'second take' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    assert.equal(screen.queryByText('first take'), null);
    assert.ok(screen.getByText('second take'));
    assert.ok(screen.getByText('send:2'));

    fireEvent.click(screen.getAllByLabelText('workspace.changes.comment.remove')[0]);
    assert.ok(screen.getByText('send:1'));

    fireEvent.click(screen.getAllByLabelText('workspace.changes.comment.add')[2]);
    const last = screen.getByLabelText('workspace.changes.comment.placeholder') as HTMLInputElement;
    fireEvent.change(last, { target: { value: 'and keep' } });
    fireEvent.keyDown(last, { key: 'Enter', metaKey: true });
    assert.equal(inserted.length, 1);
    assert.match(inserted[0], /^second take\n\nsrc\/file\.ts:1\n> \+new\n\nand keep\n\nsrc\/file\.ts:2\n> keep$/);
    assert.equal(screen.queryByText(/^send:/), null);
  } finally {
    restore();
  }
});

test('an unavailable composer keeps the review instead of discarding it', async () => {
  const restore = renderTab([file], () => false);
  try {
    fireEvent.click(await screen.findByText('src/file.ts'));
    await addComment(1, 'keep me');
    fireEvent.click(screen.getByText('send:1'));

    assert.ok(screen.getByText('keep me'));
    assert.ok(screen.getByText('send:1'));

    fireEvent.click(screen.getByText('workspace.changes.review.clear'));
    assert.equal(screen.queryByText('keep me'), null);
    assert.equal(screen.queryByText(/^send:/), null);
  } finally {
    restore();
  }
});

test('the Last-turn scope picks up history that arrives after the tab opened', async () => {
  let messages: unknown[] = [];
  const listeners = new Set<() => void>();
  const sessionStore = {
    getMessages: () => messages,
    getSessionSlot: () => ({ status: 'idle' }),
    subscribeSession: (_id: string, listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  } as unknown as SessionStore;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(createElement(QueryClientProvider, { client: queryClient },
    createElement(I18nextProvider, { i18n },
      createElement(WorkspaceChangesTab, { projectId: 'project', projectPath: '/tmp/project', sessionId: 'session', sessionStore, lastTurnRunning: false, active: true }),
    ),
  ));
  fireEvent.click(screen.getByRole('button', { name: 'workspace.changes.scope.lastTurn' }));
  assert.ok(screen.getByText('workspace.changes.emptyTurn'));
  assert.equal(listeners.size, 1, 'the tab subscribes to its session');

  // History lands: the store notifies, nobody clicks anything.
  messages = [
    { id: 'user', sessionId: 'session', timestamp: '2026-01-01T00:00:00Z', provider: 'gjc', kind: 'text', role: 'user', content: 'write it' },
    { id: 'write', sessionId: 'session', timestamp: '2026-01-01T00:00:01Z', provider: 'gjc', kind: 'tool_use', toolId: 'write-1', toolName: 'write', toolInput: { path: 'hello.py', content: 'print(1)\n' }, toolResult: { content: 'ok', isError: false } },
  ];
  act(() => { listeners.forEach((listener) => listener()); });

  assert.ok(await screen.findByText('hello.py'));
  assert.equal(screen.queryByText('workspace.changes.emptyTurn'), null);
});

test('an orphaned mutation is not shown as loading after the run is idle', () => {
  const messages = [
    { id: 'user', sessionId: 'session', timestamp: '2026-01-01T00:00:00Z', provider: 'gjc', kind: 'text', role: 'user', content: 'edit it' },
    { id: 'edit', sessionId: 'session', timestamp: '2026-01-01T00:00:01Z', provider: 'gjc', kind: 'tool_use', toolId: 'edit-1', toolName: 'edit', toolInput: { path: 'file.ts', edits: [] } },
  ];
  const sessionStore = {
    getMessages: () => messages,
    getSessionSlot: () => ({ status: 'idle' }),
    subscribeSession: () => () => {},
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
