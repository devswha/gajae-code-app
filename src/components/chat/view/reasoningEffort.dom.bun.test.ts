import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { readReasoningEffort, rememberReasoningEffort, type ReasoningEffort } from './reasoningEffort';

afterEach(() => { localStorage.clear(); });

test('with nothing recorded the composer starts at the default level', () => {
  assert.equal(readReasoningEffort(), 'default');
});

test('every level the picker offers is recorded and read back', () => {
  for (const effort of ['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as ReasoningEffort[]) {
    rememberReasoningEffort(effort);
    assert.equal(readReasoningEffort(), effort);
  }
});

test('a record from another build or a corrupt one degrades to the default level', () => {
  for (const stored of ['', 'turbo', 'inherit', 'HIGH', '{"effort":"high"}', 'toString']) {
    localStorage.setItem('gjc-reasoning-effort', stored);
    assert.equal(readReasoningEffort(), 'default', stored);
  }
});

test('a storage that throws never propagates out of read or write', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('full'); },
    },
  });
  try {
    assert.equal(readReasoningEffort(), 'default');
    rememberReasoningEffort('high');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', original);
  }
});
