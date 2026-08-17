import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideQueueFlush,
  QUEUE_FLUSH_DELAY_AFTER_TURN_MS,
  QUEUE_FLUSH_DELAY_ON_RESTORE_MS,
  type QueueFlushInput,
} from './queueFlush';

const idleWithQueue: QueueFlushInput = {
  sessionSwitched: false,
  isLoading: false,
  wasLoading: true,
  queueLength: 2,
  awaitingDispatchedTurn: false,
  composerHasInput: false,
};

test('a turn that just ended flushes the head immediately', () => {
  assert.deepEqual(decideQueueFlush(idleWithQueue), {
    action: 'flush',
    delayMs: QUEUE_FLUSH_DELAY_AFTER_TURN_MS,
  });
});

test('a queue restored into an apparently idle session waits for the subscribe ack', () => {
  assert.deepEqual(decideQueueFlush({ ...idleWithQueue, wasLoading: false }), {
    action: 'flush',
    delayMs: QUEUE_FLUSH_DELAY_ON_RESTORE_MS,
  });
});

test('a queue never drains in one burst while its dispatch has not become a run', () => {
  // The regression this gate exists for: the dispatch does not flip isLoading
  // synchronously, so the next evaluation still sees an idle session.
  const decision = decideQueueFlush({ ...idleWithQueue, awaitingDispatchedTurn: true });

  assert.deepEqual(decision, { action: 'skip', reason: 'awaiting-dispatch' });
});

test('nothing is sent while a run is in flight', () => {
  assert.deepEqual(decideQueueFlush({ ...idleWithQueue, isLoading: true }), {
    action: 'skip',
    reason: 'run-in-flight',
  });
});

test('a run in flight outranks a stale dispatch gate', () => {
  assert.deepEqual(
    decideQueueFlush({ ...idleWithQueue, isLoading: true, awaitingDispatchedTurn: true }),
    { action: 'skip', reason: 'run-in-flight' },
  );
});

test('an empty queue has nothing to flush', () => {
  assert.deepEqual(decideQueueFlush({ ...idleWithQueue, queueLength: 0 }), {
    action: 'skip',
    reason: 'empty',
  });
});

test('a session switch never flushes, because isLoading describes the other session', () => {
  assert.deepEqual(decideQueueFlush({ ...idleWithQueue, sessionSwitched: true }), {
    action: 'skip',
    reason: 'session-switched',
  });
  assert.deepEqual(
    decideQueueFlush({ ...idleWithQueue, sessionSwitched: true, isLoading: true }),
    { action: 'skip', reason: 'session-switched' },
  );
});

test('text in the composer is never clobbered by a flush', () => {
  // Regression: pulling a queued message back out to edit it left the rest of
  // the queue free to overwrite the composer and send the head instead.
  assert.deepEqual(decideQueueFlush({ ...idleWithQueue, composerHasInput: true }), {
    action: 'skip',
    reason: 'composer-has-input',
  });
});

test('the queue resumes as soon as the composer is empty again', () => {
  assert.equal(decideQueueFlush({ ...idleWithQueue, composerHasInput: false }).action, 'flush');
});

test('one message flushes on the same terms as many', () => {
  assert.equal(decideQueueFlush({ ...idleWithQueue, queueLength: 1 }).action, 'flush');
});
