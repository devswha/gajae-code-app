import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  clearQueuedMessages,
  draftInputKey,
  draftKeysToClear,
  forgetSessionStorage,
  queuedMessageKey,
  readQueuedMessages,
  reorderQueue,
  safeLocalStorage,
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

/*
 * Which slots a send retires.
 *
 * Splitting one slot into two made "clear the draft" ambiguous: the project
 * slot stopped meaning "this conversation" and started meaning "the chat that
 * has not started yet". Clearing both on every send deleted text the user had
 * typed into a different composer.
 */

test('sending from an established session leaves the unstarted chat draft alone', () => {
  localStorage.setItem(draftInputKey('proj-1'), 'typed into the new chat');

  const cleared = draftKeysToClear('proj-1', SESSION);

  assert.deepEqual(cleared, [draftInputKey('proj-1', SESSION)]);
  cleared.forEach((key) => localStorage.removeItem(key));
  assert.equal(localStorage.getItem(draftInputKey('proj-1')), 'typed into the new chat');
});

test('a first send retires the project slot that actually held the text', () => {
  // No session existed when the text was typed, so the project slot is the
  // conversation, and the session it just created has to go with it.
  const cleared = draftKeysToClear('proj-1', null, 'session-new');

  assert.deepEqual(cleared, [draftInputKey('proj-1'), draftInputKey('proj-1', 'session-new')]);
});

test('a send from a session that settled under the same id clears one slot', () => {
  assert.deepEqual(draftKeysToClear('proj-1', SESSION, SESSION), [draftInputKey('proj-1', SESSION)]);
});

test('steering to another session retires that session too', () => {
  assert.deepEqual(
    draftKeysToClear('proj-1', SESSION, 'session-2'),
    [draftInputKey('proj-1', SESSION), draftInputKey('proj-1', 'session-2')],
  );
});

/*
 * Session-scoped keys need someone to reap them.
 *
 * Both shapes below outlive the conversation that created them, and the only
 * thing that ever collected them was the quota handler - a failure path, not a
 * lifecycle. Deleting a session is where they actually stop being needed.
 */

test('deleting a session forgets its draft and its queue', () => {
  localStorage.setItem(draftInputKey('proj-1', SESSION), 'unsent');
  writeQueuedMessages(SESSION, [{ content: 'waiting' }]);

  forgetSessionStorage(SESSION);

  assert.equal(localStorage.getItem(draftInputKey('proj-1', SESSION)), null);
  assert.deepEqual(readQueuedMessages(SESSION), []);
});

test('forgetting one session leaves every other one alone', () => {
  localStorage.setItem(draftInputKey('proj-1', 'session-a'), 'a');
  localStorage.setItem(draftInputKey('proj-1', 'session-b'), 'b');
  localStorage.setItem(draftInputKey('proj-1'), 'unstarted chat');
  writeQueuedMessages('session-b', [{ content: 'still waiting' }]);

  forgetSessionStorage('session-a');

  assert.equal(localStorage.getItem(draftInputKey('proj-1', 'session-b')), 'b');
  assert.equal(localStorage.getItem(draftInputKey('proj-1')), 'unstarted chat');
  assert.deepEqual(readQueuedMessages('session-b'), [{ content: 'still waiting' }]);
});

/*
 * What a full store gives up, and in what order.
 *
 * A draft is unsent text the user can see and retype. A queued message is one
 * they already sent and are waiting on - the reader in this file normalizes
 * three historical shapes rather than drop one. The sweep used to take both in
 * a single pass, so an unrelated write could silently swallow a request.
 */

/**
 * A Storage that can be made to refuse writes.
 *
 * The sweep reads `Object.keys(localStorage)`, which on a real Storage yields
 * the stored keys - so the fake has to expose them as own enumerable
 * properties rather than as a Map hidden behind methods, or the sweep finds
 * nothing to drop and the test proves the opposite of what it claims.
 */
const refusingStorage = (isFull: (data: Map<string, string>) => boolean): Storage => {
  const data = new Map<string, string>();
  const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
  const methods = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (isFull(data)) throw quota;
      data.set(key, value);
    },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
  return new Proxy(methods, {
    ownKeys: () => [...data.keys()],
    getOwnPropertyDescriptor: (_target, prop) => (
      typeof prop === 'string' && data.has(prop)
        ? { value: data.get(prop), enumerable: true, configurable: true }
        : undefined
    ),
  }) as unknown as Storage;
};

const withStorage = (storage: Storage, body: () => void) => {
  const previous = (globalThis as { localStorage: Storage }).localStorage;
  (globalThis as { localStorage: Storage }).localStorage = storage;
  try { body(); } finally {
    (globalThis as { localStorage: Storage }).localStorage = previous;
  }
};

const captureWarnings = (body: () => void): string[] => {
  const seen: string[] = [];
  const real = console.warn;
  console.warn = (message?: unknown) => { seen.push(String(message)); };
  try { body(); } finally { console.warn = real; }
  return seen;
};

test('a full store gives up drafts before anything a user is waiting on', () => {
  const staleDraft = draftInputKey('proj-1', 'session-a');
  let full = false;
  // Room appears the moment the stale draft is gone - so a correct sweep never
  // needs to reach the queue.
  const storage = refusingStorage((data) => full && data.has(staleDraft));

  const warnings = captureWarnings(() => withStorage(storage, () => {
    localStorage.setItem(staleDraft, 'unsent text');
    writeQueuedMessages('session-b', [{ content: 'still waiting' }]);
    full = true;

    safeLocalStorage.setItem('unrelated_key', 'value');

    assert.equal(localStorage.getItem('unrelated_key'), 'value');
    assert.equal(localStorage.getItem(staleDraft), null, 'the draft was the cheap thing to lose');
    assert.deepEqual(
      readQueuedMessages('session-b'),
      [{ content: 'still waiting' }],
      'a message the user is waiting on survives a sweep that drafts alone could satisfy',
    );
  }));

  assert.deepEqual(warnings, [], 'dropping drafts is routine and needs no warning');
});

test('a store still full after the drafts go takes queued messages last, and says so', () => {
  const queue = queuedMessageKey('session-b');
  let full = false;
  // Dropping every draft is not enough here; only the queue frees space.
  const storage = refusingStorage((data) => full && data.has(queue));

  const warnings = captureWarnings(() => withStorage(storage, () => {
    localStorage.setItem(draftInputKey('proj-1', 'session-a'), 'unsent text');
    writeQueuedMessages('session-b', [{ content: 'still waiting' }]);
    full = true;

    safeLocalStorage.setItem('unrelated_key', 'value');

    assert.equal(localStorage.getItem('unrelated_key'), 'value');
    assert.deepEqual(readQueuedMessages('session-b'), []);
  }));

  assert.equal(warnings.length, 1, 'losing a queued message is never silent');
  assert.match(warnings[0], /discarded 1 queued message/);
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
