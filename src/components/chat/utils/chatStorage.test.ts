import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  clearQueuedMessages,
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
