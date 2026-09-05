import assert from 'node:assert/strict';
import test from 'node:test';

import { assignTranscriptTurns, type TranscriptTurnRecord } from '@/modules/providers/list/gjc/gjc-transcript-turns.js';

/*
 * The cases here are the ones that make reading the flat transcript order
 * wrong. Each was measured in a real session before it was written down.
 */

const user = (id: string, parentId?: string): TranscriptTurnRecord => ({ id, parentId, role: 'user' });
const tool = (id: string, parentId: string): TranscriptTurnRecord => ({ id, parentId, role: 'toolResult' });
const assistant = (id: string, parentId: string, stopReason?: string): TranscriptTurnRecord =>
  ({ id, parentId, role: 'assistant', stopReason });

test('a user record that roots a segment begins a turn', () => {
  const turns = assignTranscriptTurns([
    user('u1'),
    assistant('a1', 'u1', 'stop'),
  ]);

  assert.equal(turns.get('u1')?.turnId, 'u1');
  assert.equal(turns.get('a1')?.turnId, 'u1');
});

test('a user record injected mid-turn does not begin one', () => {
  // Steering: the user types while a turn is running, so the record's parent is
  // the tool result it interrupted. Reading the flat order would start a second
  // turn here and split one changed-file card into two.
  const turns = assignTranscriptTurns([
    user('u1'),
    assistant('a1', 'u1', 'toolUse'),
    tool('t1', 'a1'),
    user('steer', 't1'),
    assistant('a2', 'steer', 'stop'),
  ]);

  assert.equal(turns.get('steer')?.turnId, 'u1', 'the steer belongs to the running turn');
  assert.equal(turns.get('a2')?.turnId, 'u1', 'and so does everything after it');
});

test('a second rooted user record begins a second turn', () => {
  const turns = assignTranscriptTurns([
    user('u1'),
    assistant('a1', 'u1', 'stop'),
    user('u2'),
    assistant('a2', 'u2', 'stop'),
  ]);

  assert.equal(turns.get('a1')?.turnId, 'u1');
  assert.equal(turns.get('a2')?.turnId, 'u2');
});

test('a prompt following a terminal assistant begins a separate turn', () => {
  for (const reason of ['stop', 'error', 'aborted']) {
    const turns = assignTranscriptTurns([
      user('u1'),
      assistant('a1', 'u1', reason),
      user('u2', 'a1'),
      assistant('a2', 'u2', 'toolUse'),
    ]);

    assert.equal(turns.get('u2')?.turnId, 'u2', reason);
    assert.equal(turns.get('a2')?.turnId, 'u2', reason);
    assert.equal(turns.get('u2')?.status, 'running', reason);
    assert.notEqual(turns.get('u1')?.status, 'running', reason);
  }
});

test('control entries before steering do not split a running turn', () => {
  const turns = assignTranscriptTurns([
    user('u1'),
    assistant('a1', 'u1', 'toolUse'),
    { id: 'compact', parentId: 'a1' },
    { id: 'model', parentId: 'compact' },
    user('steer', 'model'),
    assistant('a2', 'steer', 'stop'),
  ]);

  assert.equal(turns.get('steer')?.turnId, 'u1');
  assert.equal(turns.get('a2')?.turnId, 'u1');
});

test('a turn is running until an assistant record settles it', () => {
  const turns = assignTranscriptTurns([
    user('u1'),
    assistant('a1', 'u1', 'toolUse'),
    tool('t1', 'a1'),
  ]);

  assert.equal(turns.get('t1')?.status, 'running', 'toolUse is mid-turn, not an ending');
});

test('stopReason decides how the turn ended', () => {
  for (const [stopReason, expected] of [['stop', 'completed'], ['error', 'failed'], ['aborted', 'aborted']] as const) {
    const turns = assignTranscriptTurns([user('u1'), assistant('a1', 'u1', stopReason)]);
    assert.equal(turns.get('u1')?.status, expected, `${stopReason} should read as ${expected}`);
  }
});

test('the status reaches every record of the turn, not only the last', () => {
  // The card is anchored to the initiating user message, so that record has to
  // carry the outcome even though the outcome arrives later.
  const turns = assignTranscriptTurns([
    user('u1'),
    assistant('a1', 'u1', 'toolUse'),
    tool('t1', 'a1'),
    assistant('a2', 't1', 'aborted'),
  ]);

  for (const id of ['u1', 'a1', 't1', 'a2']) {
    assert.equal(turns.get(id)?.status, 'aborted', `${id} should report the turn's outcome`);
  }
});

test('a later ending replaces an earlier one within the same turn', () => {
  const turns = assignTranscriptTurns([
    user('u1'),
    assistant('a1', 'u1', 'error'),
    assistant('a2', 'a1', 'stop'),
  ]);

  assert.equal(turns.get('u1')?.status, 'completed', 'a turn that recovered ends as it ended');
});

test('records descending from no user record are left unassigned', () => {
  // Compaction can drop a turn's root, and a transcript can be read from
  // partway through. Guessing a turn id here would anchor revert to the wrong
  // message, so the record is reported as having no turn instead.
  const turns = assignTranscriptTurns([
    assistant('orphan', 'gone', 'stop'),
    user('u1'),
    assistant('a1', 'u1', 'stop'),
  ]);

  assert.equal(turns.has('orphan'), false);
  assert.equal(turns.get('a1')?.turnId, 'u1');
});

test('lineage runs through non-message records', () => {
  // Compaction, model changes and custom entries sit in the same chain. Passing
  // only the messages severs it: measured over 36 real sessions, that left a
  // fifth of all records unable to reach their turn.
  const link = (id: string, parentId: string): TranscriptTurnRecord => ({ id, parentId });
  const turns = assignTranscriptTurns([
    user('u1'),
    assistant('a1', 'u1', 'toolUse'),
    link('model-change', 'a1'),
    assistant('a2', 'model-change', 'stop'),
  ]);

  assert.equal(turns.get('a2')?.turnId, 'u1', 'the record past the link still belongs to the turn');
});

test('a non-message record is never assigned a turn of its own', () => {
  const turns = assignTranscriptTurns([
    user('u1'),
    { id: 'compaction', parentId: 'u1' },
  ]);

  assert.equal(turns.has('compaction'), false);
});

test('a user record after compaction begins a turn', () => {
  // Its parent exists, but it is not a message: resuming after compaction is a
  // new prompt, not an injection into something still running.
  const turns = assignTranscriptTurns([
    user('u1'),
    assistant('a1', 'u1', 'stop'),
    { id: 'compaction', parentId: 'a1' },
    user('u2', 'compaction'),
    assistant('a2', 'u2', 'stop'),
  ]);

  assert.equal(turns.get('u2')?.turnId, 'u2');
  assert.equal(turns.get('a2')?.turnId, 'u2');
});

test('a lineage cycle terminates instead of hanging', () => {
  const turns = assignTranscriptTurns([
    { id: 'x', parentId: 'y', role: 'assistant' },
    { id: 'y', parentId: 'x', role: 'assistant' },
  ]);

  assert.equal(turns.size, 0);
});

test('a long chain resolves once per record', () => {
  const records: TranscriptTurnRecord[] = [user('u1')];
  for (let index = 0; index < 5_000; index += 1) {
    records.push(assistant(`a${index}`, index === 0 ? 'u1' : `a${index - 1}`, 'toolUse'));
  }
  records.push(assistant('final', 'a4999', 'stop'));

  const started = Date.now();
  const turns = assignTranscriptTurns(records);
  assert.equal(turns.get('final')?.turnId, 'u1');
  assert.equal(turns.get('a2500')?.status, 'completed');
  assert.ok(Date.now() - started < 1_000, 'memoisation should keep this linear, not quadratic');
});
