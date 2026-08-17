import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_SESSION_STATUS,
  formatTokens,
  readSessionFacts,
  readTokenTotals,
  sameSessionStatus,
  type SessionStatusSnapshot,
} from './sessionStatusSnapshot';

test('session facts are read only when the runtime actually reported them', () => {
  const facts = readSessionFacts({
    modelId: 'anthropic/claude',
    thinkingLevel: 'high',
    cwd: '/work/alpha',
    contextTokens: 12_000,
    contextWindow: 200_000,
    contextPercent: 6,
    contextSource: 'exact',
  });

  assert.deepEqual(facts, {
    modelId: 'anthropic/claude',
    thinkingLevel: 'high',
    cwd: '/work/alpha',
    contextTokens: 12_000,
    contextWindow: 200_000,
    contextPercent: 6,
    contextSource: 'exact',
  });
});

test('blank, negative and wrongly typed fields read as unknown rather than zero', () => {
  const facts = readSessionFacts({
    modelId: '   ',
    thinkingLevel: 42,
    cwd: '',
    contextTokens: -1,
    contextWindow: 0,
    contextPercent: null,
  });

  assert.deepEqual(facts, {
    modelId: undefined,
    thinkingLevel: undefined,
    cwd: undefined,
    contextTokens: undefined,
    contextWindow: undefined,
    contextPercent: undefined,
    contextSource: undefined,
  });
});

test('a percentage over the window is clamped instead of overflowing the bar', () => {
  assert.equal(readSessionFacts({ contextPercent: 140 }).contextPercent, 100);
});

test('no session state at all yields no facts', () => {
  assert.deepEqual(readSessionFacts(null), {});
});

test('token totals come from the reported fields, cache summed across read and write', () => {
  assert.deepEqual(
    readTokenTotals({
      used: 5_000,
      inputTokens: 3_000,
      outputTokens: 1_200,
      cacheReadTokens: 500,
      cacheCreationTokens: 300,
    }),
    { used: 5_000, input: 3_000, output: 1_200, cache: 800 },
  );
});

test('token totals fall back to the breakdown the older shape carries', () => {
  assert.deepEqual(
    readTokenTotals({ breakdown: { input: 10, output: 5 } }),
    { used: 15, input: 10, output: 5, cache: undefined },
  );
});

test('a session that used nothing reports no totals instead of a row of zeroes', () => {
  assert.equal(readTokenTotals({ used: 0, inputTokens: 0, outputTokens: 0 }), undefined);
  assert.equal(readTokenTotals(null), undefined);
});

test('identical snapshots compare equal so the panel does not re-render with the chat', () => {
  const snapshot: SessionStatusSnapshot = {
    sessionId: 'session-1',
    modelId: 'anthropic/claude',
    tokens: { used: 10, input: 6, output: 4 },
    activity: { running: true, statusText: 'Compacting', queued: 1 },
  };
  const copy: SessionStatusSnapshot = {
    sessionId: 'session-1',
    modelId: 'anthropic/claude',
    tokens: { used: 10, input: 6, output: 4 },
    activity: { running: true, statusText: 'Compacting', queued: 1 },
  };

  assert.equal(sameSessionStatus(snapshot, copy), true);
});

test('every rendered field is part of the comparison', () => {
  const base: SessionStatusSnapshot = { ...EMPTY_SESSION_STATUS, sessionId: 'session-1' };

  const variants: SessionStatusSnapshot[] = [
    { ...base, sessionId: 'session-2' },
    { ...base, modelId: 'other' },
    { ...base, thinkingLevel: 'low' },
    { ...base, cwd: '/elsewhere' },
    { ...base, contextTokens: 1 },
    { ...base, contextWindow: 1 },
    { ...base, contextPercent: 1 },
    { ...base, contextSource: 'estimate' },
    { ...base, tokens: { used: 1 } },
    { ...base, activity: { running: true, statusText: null, queued: 0 } },
    { ...base, activity: { running: false, statusText: 'Retrying', queued: 0 } },
    { ...base, activity: { running: false, statusText: null, queued: 1 } },
  ];

  for (const variant of variants) {
    assert.equal(sameSessionStatus(base, variant), false, JSON.stringify(variant));
  }
});

test('token counts are shortened the same way the composer shortens them', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(-5), '0');
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1_500), '1.5K');
  assert.equal(formatTokens(12_300), '12K');
  assert.equal(formatTokens(1_500_000), '1.5M');
});
