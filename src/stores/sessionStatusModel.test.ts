import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SESSION_STATUS_PRIORITY,
  compareSessionStatus,
  deriveSessionStatus,
  needsAttention,
  outcomeOfCompletion,
  type SessionStatusFacts,
} from './sessionStatusModel';

const facts = (overrides: Partial<SessionStatusFacts> = {}): SessionStatusFacts => ({
  running: false,
  awaitingInput: false,
  outcome: null,
  lastViewedAt: null,
  isViewed: false,
  ...overrides,
});

test('a session with nothing going on is idle', () => {
  assert.equal(deriveSessionStatus(facts()), 'idle');
});

test('a run in progress is running', () => {
  assert.equal(deriveSessionStatus(facts({ running: true })), 'running');
});

test('an unanswered question wins over everything, including the open session', () => {
  assert.equal(deriveSessionStatus(facts({ awaitingInput: true })), 'needs_input');
  assert.equal(deriveSessionStatus(facts({ awaitingInput: true, running: true })), 'needs_input');
  assert.equal(deriveSessionStatus(facts({ awaitingInput: true, isViewed: true })), 'needs_input');
  assert.equal(deriveSessionStatus(facts({ awaitingInput: true, outcome: { kind: 'blocked', at: 10 } })), 'needs_input');
});

test('a finished run is ready until it is viewed', () => {
  const outcome = { kind: 'ready' as const, at: 100 };
  assert.equal(deriveSessionStatus(facts({ outcome })), 'ready', 'never viewed');
  assert.equal(deriveSessionStatus(facts({ outcome, lastViewedAt: 50 })), 'ready', 'viewed before it finished');
  assert.equal(deriveSessionStatus(facts({ outcome, lastViewedAt: 100 })), 'idle', 'viewed as it finished');
  assert.equal(deriveSessionStatus(facts({ outcome, lastViewedAt: 150 })), 'idle', 'viewed afterwards');
  assert.equal(deriveSessionStatus(facts({ outcome, isViewed: true })), 'idle', 'open right now');
});

test('a failed run is blocked until it is viewed', () => {
  const outcome = { kind: 'blocked' as const, at: 100 };
  assert.equal(deriveSessionStatus(facts({ outcome })), 'blocked');
  assert.equal(deriveSessionStatus(facts({ outcome, lastViewedAt: 99 })), 'blocked');
  assert.equal(deriveSessionStatus(facts({ outcome, lastViewedAt: 100 })), 'idle');
  assert.equal(deriveSessionStatus(facts({ outcome, isViewed: true })), 'idle');
});

test('a new run supersedes the outcome of the previous one', () => {
  assert.equal(deriveSessionStatus(facts({ running: true, outcome: { kind: 'ready', at: 1 } })), 'running');
  assert.equal(deriveSessionStatus(facts({ running: true, outcome: { kind: 'blocked', at: 1 } })), 'running');
});

test('statuses sort by what the user should look at first', () => {
  assert.deepEqual(SESSION_STATUS_PRIORITY, ['needs_input', 'blocked', 'ready', 'running', 'idle']);
  const shuffled = ['idle', 'running', 'ready', 'needs_input', 'blocked'] as const;
  assert.deepEqual([...shuffled].sort(compareSessionStatus), ['needs_input', 'blocked', 'ready', 'running', 'idle']);
  assert.equal(compareSessionStatus('ready', 'ready'), 0);
});

test('only the states that ask something of the user count as attention', () => {
  assert.equal(needsAttention('needs_input'), true);
  assert.equal(needsAttention('blocked'), true);
  assert.equal(needsAttention('ready'), true);
  assert.equal(needsAttention('running'), false);
  assert.equal(needsAttention('idle'), false);
});

test('a completion maps onto the outcome it leaves behind', () => {
  assert.deepEqual(outcomeOfCompletion({ success: true }, 5), { kind: 'ready', at: 5 });
  assert.deepEqual(outcomeOfCompletion({}, 5), { kind: 'ready', at: 5 }, 'no verdict reads as success, as the chat does');
  assert.deepEqual(outcomeOfCompletion({ success: false }, 5), { kind: 'blocked', at: 5 });
  assert.equal(outcomeOfCompletion({ success: false, aborted: true }, 5), null, 'the user stopped it and already knows');
  assert.equal(outcomeOfCompletion({ success: true, aborted: true }, 5), null);
});
