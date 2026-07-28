import assert from 'node:assert/strict';
import test from 'node:test';

import { readSessionSnapshot } from './gjc-session-state.js';

/*
 * Session facts for the composer footer.
 *
 * The app could only ever show a raw token count because the context window is
 * absent from a message's usage — but it is one call away on the session, along
 * with the reasoning level and the working directory. This reads them.
 *
 * It runs inside the turn's event path, so the tests care as much about what it
 * refuses to do (throw, guess, report a percentage with no window) as about
 * what it reads.
 */

const session = (overrides: Record<string, unknown> = {}) => ({
  model: { id: 'gpt-test' },
  thinkingLevel: 'high',
  getContextUsage: () => ({ tokens: 42_000, contextWindow: 200_000, percent: 21, source: 'exact' }),
  ...overrides,
});

const manager = (cwd: unknown = '/repos/app') => ({ getCwd: () => cwd });

test('reads model, reasoning level, cwd and context in one pass', () => {
  const snapshot = readSessionSnapshot(session(), manager());

  assert.deepEqual(snapshot, {
    modelId: 'gpt-test',
    thinkingLevel: 'high',
    contextWindow: 200_000,
    contextTokens: 42_000,
    contextSource: 'exact',
    contextPercent: 21,
    cwd: '/repos/app',
  });
});

test('the percentage the session reports is preferred over recomputing it', () => {
  // The session applies its own reserve accounting; second-guessing it here
  // would put a different number in the footer than /context reports.
  const snapshot = readSessionSnapshot(
    session({ getContextUsage: () => ({ tokens: 10, contextWindow: 100, percent: 37 }) }),
    manager(),
  );

  assert.equal(snapshot?.contextPercent, 37);
});

test('a missing percentage is derived, but only with a real window', () => {
  const derived = readSessionSnapshot(
    session({ getContextUsage: () => ({ tokens: 50_000, contextWindow: 200_000 }) }),
    manager(),
  );
  assert.equal(derived?.contextPercent, 25);

  // No window means no percentage. Falling back to a default context size
  // would render a confident number that is simply wrong for the model.
  const windowless = readSessionSnapshot(
    session({ getContextUsage: () => ({ tokens: 50_000 }) }),
    manager(),
  );
  assert.equal(windowless?.contextPercent, undefined);
  assert.equal(windowless?.contextWindow, undefined);
  assert.equal(windowless?.contextTokens, 50_000);
});

test('an unknown token count still reports the window', () => {
  // The session returns `tokens: null` until the next response. The footer can
  // still say "?/200k" rather than nothing at all.
  const snapshot = readSessionSnapshot(
    session({ getContextUsage: () => ({ tokens: null, contextWindow: 200_000, percent: null }) }),
    manager(),
  );

  assert.equal(snapshot?.contextWindow, 200_000);
  assert.equal(snapshot?.contextTokens, undefined);
  assert.equal(snapshot?.contextPercent, undefined);
});

test('a throwing session never takes the turn down with it', () => {
  // This runs on the event path of a real answer.
  const hostile = {
    get model(): never { throw new Error('model exploded'); },
    getContextUsage: () => { throw new Error('usage exploded'); },
  };
  const hostileManager = { getCwd: () => { throw new Error('cwd exploded'); } };

  assert.doesNotThrow(() => readSessionSnapshot(hostile, hostileManager));
  assert.equal(readSessionSnapshot(hostile, hostileManager), undefined);
});

test('the cwd survives a session read that failed', () => {
  const partial = readSessionSnapshot(
    { getContextUsage: () => { throw new Error('nope'); } },
    manager('/repos/app'),
  );

  assert.deepEqual(partial, { cwd: '/repos/app' });
});

test('nothing readable produces no message at all', () => {
  // An empty snapshot would blank a footer that was showing correct values.
  assert.equal(readSessionSnapshot({}, {}), undefined);
  assert.equal(readSessionSnapshot(null, null), undefined);
  assert.equal(readSessionSnapshot(undefined, undefined), undefined);
});

test('blank and malformed fields are dropped rather than forwarded', () => {
  const snapshot = readSessionSnapshot(
    {
      model: { id: '   ' },
      thinkingLevel: 42,
      getContextUsage: () => ({ tokens: -1, contextWindow: 0, source: '' }),
    },
    manager(''),
  );

  assert.equal(snapshot, undefined);
});
