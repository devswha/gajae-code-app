import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  clearQueuedMessages,
  draftInputKey,
  queuedMessageKey,
  readQueuedMessages,
  reorderQueue,
  writeQueuedMessages,
} from './chatStorage';

// The module talks to localStorage through safeLocalStorage; node has none.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
};

beforeEach(() => store.clear());

const SESSION = 'session-1';

/*
 * Draft keys.
 *
 * These existed as a bare `draft_input_<projectId>` template inlined at five
 * call sites, which meant every session in a project shared one slot: opening
 * a second conversation showed the first one's unsent text, and typing there
 * overwrote it.
 */

test('two sessions in one project keep separate drafts', () => {
  const a = draftInputKey('proj-1', 'session-a');
  const b = draftInputKey('proj-1', 'session-b');

  assert.notEqual(a, b);

  localStorage.setItem(a, 'draft for A');
  localStorage.setItem(b, 'draft for B');

  // The regression this guards: writing B must not reach A.
  assert.equal(localStorage.getItem(a), 'draft for A');
  assert.equal(localStorage.getItem(b), 'draft for B');
});

test('a chat with no session yet falls back to the project slot', () => {
  // A first message is typed before a session exists, so it needs somewhere to
  // live that does not depend on an id the backend has not allocated.
  assert.equal(draftInputKey('proj-1'), 'draft_input_proj-1');
  assert.equal(draftInputKey('proj-1', null), 'draft_input_proj-1');
  assert.equal(draftInputKey('proj-1', undefined), 'draft_input_proj-1');
});

test('the pre-session slot keeps its original key so old drafts still load', () => {
  // Drafts written by earlier versions live under this exact key. Renaming it
  // would not lose data loudly; it would orphan text the user still expects.
  localStorage.setItem('draft_input_proj-1', 'typed before the upgrade');

  assert.equal(localStorage.getItem(draftInputKey('proj-1')), 'typed before the upgrade');
});

test('both draft shapes carry the prefix the quota sweeper matches', () => {
  // safeLocalStorage drops keys starting with `draft_input_` when the quota is
  // exceeded. A session-scoped key that missed the prefix would survive that
  // sweep and keep the store full.
  assert.equal(draftInputKey('proj-1').startsWith('draft_input_'), true);
  assert.equal(draftInputKey('proj-1', 'session-a').startsWith('draft_input_'), true);
});

test('a draft key never collides with a queue key', () => {
  assert.notEqual(draftInputKey('x', SESSION), queuedMessageKey(SESSION));
});

test('a queue round-trips in send order', () => {
  writeQueuedMessages(SESSION, [{ content: 'first' }, { content: 'second', options: { model: 'x' } }]);

  assert.deepEqual(readQueuedMessages(SESSION), [
    { content: 'first' },
    { content: 'second', options: { model: 'x' } },
  ]);
});

test('an empty queue removes the key, because the key is the claim ticket', () => {
  writeQueuedMessages(SESSION, [{ content: 'first' }]);
  writeQueuedMessages(SESSION, []);

  assert.equal(store.has(queuedMessageKey(SESSION)), false);
  assert.deepEqual(readQueuedMessages(SESSION), []);
});

test('blank messages never reach storage', () => {
  writeQueuedMessages(SESSION, [{ content: '   ' }, { content: 'real' }]);

  assert.deepEqual(readQueuedMessages(SESSION), [{ content: 'real' }]);
});

test('a single-message queue written by an older build still restores', () => {
  store.set(queuedMessageKey(SESSION), JSON.stringify({ content: 'older', options: { model: 'x' } }));

  assert.deepEqual(readQueuedMessages(SESSION), [{ content: 'older', options: { model: 'x' } }]);
});

test('the original raw-text format still restores', () => {
  store.set(queuedMessageKey(SESSION), 'plain draft text');

  assert.deepEqual(readQueuedMessages(SESSION), [{ content: 'plain draft text' }]);
});

test('corrupt entries inside a stored queue are dropped, not fatal', () => {
  store.set(queuedMessageKey(SESSION), JSON.stringify([{ content: 'keep' }, null, { nope: 1 }, { content: '' }]));

  assert.deepEqual(readQueuedMessages(SESSION), [{ content: 'keep' }]);
});

test('clearing drops the whole queue', () => {
  writeQueuedMessages(SESSION, [{ content: 'a' }, { content: 'b' }]);
  clearQueuedMessages(SESSION);

  assert.deepEqual(readQueuedMessages(SESSION), []);
});

test('queues are scoped per session', () => {
  writeQueuedMessages('session-a', [{ content: 'a' }]);
  writeQueuedMessages('session-b', [{ content: 'b' }]);

  assert.deepEqual(readQueuedMessages('session-a'), [{ content: 'a' }]);
  assert.deepEqual(readQueuedMessages('session-b'), [{ content: 'b' }]);
});

test('reordering moves one message and keeps the rest in order', () => {
  assert.deepEqual(reorderQueue(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(reorderQueue(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
});

test('a move that cannot happen returns the queue unchanged', () => {
  const queue = ['a', 'b'];

  assert.deepEqual(reorderQueue(queue, 1, 1), queue);
  assert.deepEqual(reorderQueue(queue, -1, 0), queue);
  assert.deepEqual(reorderQueue(queue, 0, 5), queue);
  assert.deepEqual(reorderQueue([], 0, 0), []);
});

test('reordering never mutates the queue it was given', () => {
  const queue = ['a', 'b', 'c'];
  reorderQueue(queue, 0, 2);

  assert.deepEqual(queue, ['a', 'b', 'c']);
});
