import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';

import { sessionDelegations } from './useSessionDelegations';

const delegationCall = (id: string, subagents: unknown, toolName = 'task'): NormalizedMessage => ({
  id,
  sessionId: 'session',
  timestamp: '2026-01-01T00:00:00Z',
  provider: 'gjc',
  kind: 'tool_use',
  toolId: id,
  toolName,
  toolInput: { agent: 'executor' },
  toolResult: { content: 'ok', isError: false, toolUseResult: { subagents } },
} as unknown as NormalizedMessage);

const settlement = (id: string, delegation: unknown): NormalizedMessage => ({
  id,
  sessionId: 'session',
  timestamp: '2026-01-01T00:01:00Z',
  provider: 'gjc',
  kind: 'delegation_updated',
  delegation,
} as unknown as NormalizedMessage);

const subagent = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1', status: 'running', agent: 'executor', description: 'wire the lane', ...overrides,
});

const bareDelegationCall = (id: string, toolName = 'task'): NormalizedMessage => ({
  id,
  sessionId: 'session',
  timestamp: '2026-01-01T00:00:00Z',
  provider: 'gjc',
  kind: 'tool_use',
  toolId: id,
  toolName,
  toolInput: { agent: 'executor' },
} as unknown as NormalizedMessage);

const liveDelegationResult = (id: string, toolId: string, subagents: unknown): NormalizedMessage => ({
  id,
  sessionId: 'session',
  timestamp: '2026-01-01T00:00:30Z',
  provider: 'gjc',
  kind: 'tool_result',
  toolId,
  content: 'ok',
  isError: false,
  isFinal: true,
  toolUseResult: { subagents },
} as unknown as NormalizedMessage);

test('a running delegation in a task tool result becomes one active snapshot', () => {
  assert.deepEqual(sessionDelegations([delegationCall('t1', [subagent()])]), [
    { delegationId: 'd1', status: 'running', agent: 'executor', description: 'wire the lane' },
  ]);
});

test('several agents of one call are all reported, in the order the runtime lists them', () => {
  const delegations = sessionDelegations([delegationCall('t1', [
    subagent({ id: 'd1', agent: 'planner', description: 'sequence the work' }),
    subagent({ id: 'd2', agent: 'executor', description: 'server lane', executionMode: 'ultragoal-red-team', repositoryBinding: { root: '/repo' } }),
  ], 'subagent')]);

  assert.deepEqual(delegations.map((delegation) => delegation.delegationId), ['d1', 'd2']);
  assert.deepEqual(delegations[1], {
    delegationId: 'd2', status: 'running', agent: 'executor', description: 'server lane',
    executionMode: 'ultragoal-red-team', repositoryBinding: { root: '/repo' },
  });
});

for (const status of ['completed', 'failed', 'cancelled'] as const) {
  test(`a later ${status} receipt settles the delegation and leaves nothing running`, () => {
    const delegations = sessionDelegations([
      delegationCall('t1', [subagent()]),
      settlement('r1', { delegationId: 'd1', status, agent: 'executor', description: 'wire the lane' }),
    ]);

    assert.equal(delegations.length, 1);
    assert.equal(delegations[0].status, status);
    assert.equal(delegations.filter((delegation) => delegation.status === 'running').length, 0);
  });
}

test('a stale running tool-result snapshot is superseded by the later receipt row', () => {
  const delegations = sessionDelegations([
    settlement('r1', { delegationId: 'd1', status: 'running', agent: 'executor', description: 'wire the lane' }),
    delegationCall('t1', [subagent({ status: 'running', description: 'wire the lane' })]),
    settlement('r2', { delegationId: 'd1', status: 'completed', agent: 'executor', description: 'wire the lane' }),
  ]);

  assert.deepEqual(delegations, [{ delegationId: 'd1', status: 'completed', agent: 'executor', description: 'wire the lane' }]);
});

test('a resumed delegation reuses its ID and reads as running again: terminal state is not sticky', () => {
  const delegations = sessionDelegations([
    settlement('r1', { delegationId: 'd1', status: 'completed', agent: 'executor', description: 'wire the lane' }),
    settlement('r2', { delegationId: 'd1', status: 'running', agent: 'executor', description: 'wire the lane, round two' }),
  ]);

  assert.deepEqual(delegations, [{ delegationId: 'd1', status: 'running', agent: 'executor', description: 'wire the lane, round two' }]);
});

test('a replayed update is idempotent: the same row twice is still one delegation', () => {
  const row = settlement('r1', { delegationId: 'd1', status: 'running', agent: 'executor', description: 'wire the lane' });
  assert.equal(sessionDelegations([row, row]).length, 1);
});

test('the fold reads only the window it is given', () => {
  const mine = delegationCall('t1', [subagent({ id: 'mine' })]);
  const theirs = delegationCall('t2', [subagent({ id: 'theirs' })]);

  assert.deepEqual(sessionDelegations([mine]).map((delegation) => delegation.delegationId), ['mine']);
  assert.deepEqual(sessionDelegations([theirs]).map((delegation) => delegation.delegationId), ['theirs']);
  assert.deepEqual(sessionDelegations([]), []);
});

test('malformed rows contribute nothing rather than a half-known agent', () => {
  assert.deepEqual(sessionDelegations([
    delegationCall('t1', 'not-an-array'),
    delegationCall('t2', [
      subagent({ id: '' }),
      subagent({ id: 42 }),
      subagent({ status: 'queued' }),
      subagent({ status: undefined }),
      subagent({ agent: '' }),
      subagent({ description: 7 }),
      'garbage',
      null,
    ]),
    settlement('r1', { delegationId: 'd1', status: 'running', agent: 'executor' }),
    settlement('r2', { id: 'd1', status: 'running', agent: 'executor', description: 'wrong id key' }),
    settlement('r3', null),
    settlement('r4', 'nope'),
  ]), []);
});

test('an unknown execution mode is dropped without dropping the delegation', () => {
  assert.deepEqual(sessionDelegations([delegationCall('t1', [subagent({ executionMode: 'wild-mode' })])]), [
    { delegationId: 'd1', status: 'running', agent: 'executor', description: 'wire the lane' },
  ]);
});

test('tool results that are not delegations never contribute', () => {
  assert.deepEqual(sessionDelegations([
    { kind: 'text', role: 'assistant', content: 'spawning the executor subagent now' } as unknown as NormalizedMessage,
    delegationCall('t1', [subagent()], 'todo_write'),
    delegationCall('t2', [subagent({ id: 'd2' })], 'bash'),
  ]), []);
});

test('a live stream result row pairs back to its delegation call by toolId', () => {
  const delegations = sessionDelegations([
    bareDelegationCall('t1'),
    liveDelegationResult('r1', 't1', [subagent()]),
    settlement('r2', { delegationId: 'd1', status: 'completed', agent: 'executor', description: 'wire the lane' }),
  ]);

  assert.deepEqual(delegations, [{ delegationId: 'd1', status: 'completed', agent: 'executor', description: 'wire the lane' }]);
});

test('a result row whose call is not a delegation tool never contributes', () => {
  assert.deepEqual(sessionDelegations([
    bareDelegationCall('t1', 'bash'),
    liveDelegationResult('r1', 't1', [subagent()]),
    liveDelegationResult('r2', 'unknown-call', [subagent()]),
  ]), []);
});
