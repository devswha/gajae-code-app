import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  PENDING_INPUT_STALE_MS,
  SESSION_ATTENTION_STORAGE_KEY,
  resetSessionAttentionStore,
  useSessionAttentionStore,
} from './useSessionAttentionStore';

afterEach(() => {
  localStorage.clear();
  resetSessionAttentionStore();
});

const state = () => useSessionAttentionStore.getState();
const persisted = () => JSON.parse(localStorage.getItem(SESSION_ATTENTION_STORAGE_KEY) ?? 'null') as { outcomes: Record<string, unknown>; lastViewedAt: Record<string, number> } | null;

test('outcomes and last-viewed times survive a reload; pending questions do not', () => {
  state().recordOutcome('finished', { kind: 'ready', at: 100 });
  state().recordOutcome('failed', { kind: 'blocked', at: 200 });
  state().markSessionViewed('seen', 300);
  state().addPendingInput('asking', 'req-1');

  assert.deepEqual(persisted(), {
    outcomes: { finished: { kind: 'ready', at: 100 }, failed: { kind: 'blocked', at: 200 } },
    lastViewedAt: { seen: 300 },
  });

  resetSessionAttentionStore();
  assert.deepEqual(state().outcomes, { finished: { kind: 'ready', at: 100 }, failed: { kind: 'blocked', at: 200 } });
  assert.deepEqual(state().lastViewedAt, { seen: 300 });
  assert.deepEqual(state().pendingInput, {});
});

test('viewing a session drops its outcome and records when it was seen', () => {
  state().recordOutcome('finished', { kind: 'ready', at: 100 });
  state().markSessionViewed('finished', 150);

  assert.equal(state().outcomes.finished, undefined);
  assert.equal(state().lastViewedAt.finished, 150);
  assert.equal(persisted()?.outcomes.finished, undefined);

  // Viewing never moves the clock backwards.
  state().markSessionViewed('finished', 120);
  assert.equal(state().lastViewedAt.finished, 150);
});

test('malformed storage is ignored rather than trusted', () => {
  localStorage.setItem(SESSION_ATTENTION_STORAGE_KEY, JSON.stringify({
    outcomes: { ok: { kind: 'ready', at: 1 }, badKind: { kind: 'done', at: 1 }, badTime: { kind: 'ready', at: 'now' } },
    lastViewedAt: { ok: 5, bad: 'yesterday' },
  }));
  resetSessionAttentionStore();
  assert.deepEqual(state().outcomes, { ok: { kind: 'ready', at: 1 } });
  assert.deepEqual(state().lastViewedAt, { ok: 5 });

  localStorage.setItem(SESSION_ATTENTION_STORAGE_KEY, '{not json');
  resetSessionAttentionStore();
  assert.deepEqual(state().outcomes, {});
});

test('questions are tracked per request and answered by id alone', () => {
  state().addPendingInput('s1', 'req-1');
  state().addPendingInput('s1', 'req-2');
  state().addPendingInput('s1', 'req-1');
  state().addPendingInput('s2', 'req-3');
  assert.deepEqual(state().pendingInput.s1.requestIds, ['req-1', 'req-2']);

  state().removePendingInput('req-1');
  assert.deepEqual(state().pendingInput.s1.requestIds, ['req-2']);
  state().removePendingInput('req-2');
  assert.equal(state().pendingInput.s1, undefined, 'the last answer clears the session');
  assert.deepEqual(state().pendingInput.s2.requestIds, ['req-3']);

  state().setPendingInput('s2', []);
  assert.equal(state().pendingInput.s2, undefined);
});

test('the server view clears a local question only once it is older than a poll could be', () => {
  const started = 1_000_000;
  state().addPendingInput('s1', 'req-1');
  useSessionAttentionStore.setState({ pendingInput: { s1: { requestIds: ['req-1'], since: started } } });

  state().reconcilePendingInput('s1', false, started + PENDING_INPUT_STALE_MS - 1);
  assert.ok(state().pendingInput.s1, 'a poll that may predate the question does not clear it');

  state().reconcilePendingInput('s1', false, started + PENDING_INPUT_STALE_MS);
  assert.equal(state().pendingInput.s1, undefined, 'a poll after the grace window is believed');
});

test('a question the server knows about is recorded and released with the server', () => {
  state().reconcilePendingInput('s1', true, 10);
  assert.deepEqual(state().pendingInput.s1.requestIds, ['server:s1']);

  state().reconcilePendingInput('s1', false, 11);
  assert.equal(state().pendingInput.s1, undefined, 'a server-only marker needs no grace window');
});

test('forgetting a session removes every trace of it', () => {
  state().recordOutcome('gone', { kind: 'blocked', at: 1 });
  state().markSessionViewed('gone', 2);
  state().addPendingInput('gone', 'req');
  state().forgetSession('gone');

  assert.equal(state().outcomes.gone, undefined);
  assert.equal(state().lastViewedAt.gone, undefined);
  assert.equal(state().pendingInput.gone, undefined);
  assert.equal(persisted()?.lastViewedAt.gone, undefined);
});
