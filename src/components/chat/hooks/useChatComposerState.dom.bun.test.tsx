import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import type { Project, ProjectSession } from '../../../types/app';
import { draftInputKey, readQueuedMessages, writeQueuedMessages } from '../utils/chatStorage';

import { useChatComposerState } from './useChatComposerState';

/*
 * Drafts belong to a conversation, and the wiring that makes that true lives
 * in effects: which key is read when the session in view changes, and which
 * key the next keystroke is written under. A static render cannot reach either,
 * which is why the original bug - opening a second conversation and finding the
 * first one's unsent text, then overwriting it - survived a green suite.
 */

const project: Project = {
  projectId: 'proj-1',
  displayName: 'Project one',
  fullPath: '/repos/project-one',
  origin: 'explicit',
};

const session = (id: string): ProjectSession => ({ id, __provider: 'gjc', summary: `Session ${id}` } as ProjectSession);

const baseArgs = {
  selectedProject: project,
  selectedSession: null as ProjectSession | null,
  currentSessionId: null as string | null,
  gjcModel: 'gjc/test-model',
  reasoningEffort: 'default',
  isLoading: false,
  canAbortSession: false,
  tokenBudget: null,
  sendMessage: (_message: unknown) => {},
  scrollToBottom: () => undefined,
  addMessage: (_message: unknown) => {},
  setIsUserScrolledUp: () => undefined,
  setPendingPermissionRequests: () => undefined,
};

const composer = (overrides: Partial<typeof baseArgs> = {}) =>
  renderHook(
    (props: Partial<typeof baseArgs>) => useChatComposerState({ ...baseArgs, ...props } as never),
    { initialProps: overrides },
  );

// The composer fetches slash commands and mentionable files on mount. There is
// no server here, and a real socket error is noise that has nothing to do with
// what these tests assert.
globalThis.fetch = (async () => new Response('[]', {
  status: 200,
  headers: { 'content-type': 'application/json' },
})) as typeof fetch;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test('typing in one session does not reach another session in the same project', () => {
  const view = composer({ selectedSession: session('session-a') });

  act(() => { view.result.current.setInput('draft for A'); });
  view.rerender({ selectedSession: session('session-b') });
  act(() => { view.result.current.setInput('draft for B'); });

  assert.equal(localStorage.getItem(draftInputKey('proj-1', 'session-a')), 'draft for A');
  assert.equal(localStorage.getItem(draftInputKey('proj-1', 'session-b')), 'draft for B');
});

test('switching back to a session restores that session own draft', () => {
  const view = composer({ selectedSession: session('session-a') });

  act(() => { view.result.current.setInput('draft for A'); });
  view.rerender({ selectedSession: session('session-b') });
  act(() => { view.result.current.setInput('draft for B'); });
  view.rerender({ selectedSession: session('session-a') });

  assert.equal(view.result.current.input, 'draft for A');
});

test('opening a session with no draft shows an empty composer, not the last one', () => {
  // The regression in its most visible form: the previous conversation's text
  // appearing in a composer that should be blank.
  const view = composer({ selectedSession: session('session-a') });

  act(() => { view.result.current.setInput('draft for A'); });
  view.rerender({ selectedSession: session('session-fresh') });

  assert.equal(view.result.current.input, '');
});

test('a draft typed before any session exists is loaded back into the same chat', () => {
  const view = composer({ selectedSession: null, currentSessionId: null });

  act(() => { view.result.current.setInput('typed before the session existed'); });

  assert.equal(
    localStorage.getItem(draftInputKey('proj-1')),
    'typed before the session existed',
    'a chat with no session yet keeps its text in the project slot',
  );

  view.unmount();
  const reopened = composer({ selectedSession: null, currentSessionId: null });
  assert.equal(reopened.result.current.input, 'typed before the session existed');
});

test('an established session leaves the unstarted chat draft where it is', () => {
  // Both slots exist at once, and they are not the same conversation.
  localStorage.setItem(draftInputKey('proj-1'), 'typed into the new chat');

  const view = composer({ selectedSession: session('session-a') });
  act(() => { view.result.current.setInput('draft for A'); });

  assert.equal(localStorage.getItem(draftInputKey('proj-1')), 'typed into the new chat');
  assert.equal(localStorage.getItem(draftInputKey('proj-1', 'session-a')), 'draft for A');
});

test('clearing the composer removes the stored draft rather than storing an empty one', () => {
  const view = composer({ selectedSession: session('session-a') });

  act(() => { view.result.current.setInput('draft for A'); });
  act(() => { view.result.current.setInput(''); });

  assert.equal(localStorage.getItem(draftInputKey('proj-1', 'session-a')), null);
});

const submit = () => ({ preventDefault() {} }) as never;
const typeText = (view: ReturnType<typeof composer>, text: string) => act(() => {
  view.result.current.handleInputChange({ target: { value: text, selectionStart: text.length } } as never);
});

test('automatic queue dispatch keeps the model and effort chosen when queued', async () => {
  const sent: unknown[] = [];
  const sendMessage = (message: unknown) => { sent.push(message); };
  writeQueuedMessages('a', [{ content: 'queued work', options: { model: 'queued-model', effort: 'xhigh', sessionSummary: 'queued summary' } }]);
  const view = composer({ selectedSession: session('a'), isLoading: true, sendMessage });
  view.rerender({ selectedSession: session('a'), isLoading: false, gjcModel: 'different-model', reasoningEffort: 'low', sendMessage });
  await waitFor(() => assert.equal(sent.length, 1));
  assert.deepEqual(sent[0], {
    type: 'chat.send', sessionId: 'a', content: 'queued work',
    options: { model: 'queued-model', effort: 'xhigh', sessionSummary: 'queued summary', images: [] },
  });
});

test('steering acknowledgements affect their owning queue even when another session steers identical text', () => {
  const echoed: unknown[] = [];
  const addMessage = (message: unknown) => { echoed.push(message); };
  const view = composer({ selectedSession: session('a'), isLoading: true, addMessage });
  typeText(view, 'same steer');
  act(() => { view.result.current.handleSteer(submit()); });
  view.rerender({ selectedSession: session('b'), isLoading: true, addMessage });
  typeText(view, 'same steer');
  act(() => { view.result.current.handleSteer(submit()); });
  act(() => { view.result.current.resolveSteerResult('same steer', true, 'a'); });
  assert.equal(view.result.current.queuedDrafts.length, 1, 'B still awaits its own acknowledgement');
  assert.equal(view.result.current.queuedDrafts[0].pendingSteer, true);
  assert.equal(readQueuedMessages('a').length, 0, 'accepted steering is removed from A storage');
  assert.deepEqual(echoed, [], 'A steering must never echo into B');
  act(() => { view.result.current.resolveSteerResult('same steer', true, 'b'); });
  assert.equal(view.result.current.queuedDrafts.length, 0);
  assert.equal(echoed.length, 1);
});

test('a rejected background steer stays queued in its own session', () => {
  const view = composer({ selectedSession: session('a'), isLoading: true });
  typeText(view, 'keep for A');
  act(() => { view.result.current.handleSteer(submit()); });
  view.rerender({ selectedSession: session('b'), isLoading: true });
  act(() => { view.result.current.resolveSteerResult('keep for A', false, 'a'); });
  assert.deepEqual(view.result.current.queuedDrafts, []);
  assert.equal(readQueuedMessages('a')[0]?.content, 'keep for A');
});

test('returning to an awaiting steer does not turn it into an ordinary queued send', () => {
  const view = composer({ selectedSession: session('a'), isLoading: true });
  typeText(view, 'wait for acknowledgement');
  act(() => { view.result.current.handleSteer(submit()); });
  view.rerender({ selectedSession: session('b'), isLoading: true });
  view.rerender({ selectedSession: session('a'), isLoading: true });
  assert.equal(view.result.current.queuedDrafts[0]?.pendingSteer, true);
});

test('accepting a background steer preserves an ordinary queued message with the same text', () => {
  writeQueuedMessages('a', [{ content: 'repeat this' }]);
  const view = composer({ selectedSession: session('a'), isLoading: true });
  typeText(view, 'repeat this');
  act(() => { view.result.current.handleSteer(submit()); });
  view.rerender({ selectedSession: session('b'), isLoading: true });
  act(() => { view.result.current.resolveSteerResult('repeat this', true, 'a'); });
  assert.deepEqual(readQueuedMessages('a'), [{ content: 'repeat this' }]);
});
