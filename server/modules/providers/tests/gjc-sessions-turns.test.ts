import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { GjcSessionsProvider } from '@/modules/providers/list/gjc/gjc-sessions.provider.js';

/*
 * Turn identity through the real reader, not the derivation in isolation.
 *
 * The derivation is covered by gjc-transcript-turns.test.ts. What is covered
 * here is the wiring: that the reader collects the whole lineage before
 * assigning, and that every message one transcript record produces carries the
 * turn - a text part, a tool call and a tool result all belong to the same one,
 * and a card built from a turn that lost some of them is quietly wrong rather
 * than visibly broken.
 */

const SESSION_ID = 'gjc-turns-fixture';

/**
 * A transcript with the case that matters: a steer arriving while a turn is
 * running. Reading the flat order would start a second turn at `steer`.
 */
function transcriptLines(workspacePath: string): string[] {
  const at = (seconds: number) => `2026-07-09T00:00:${String(seconds).padStart(2, '0')}.000Z`;
  return [
    { type: 'session', version: 3, id: SESSION_ID, timestamp: at(0), cwd: workspacePath },
    { type: 'message', id: 'u1', parentId: null, timestamp: at(1), message: { role: 'user', content: [{ type: 'text', text: 'first prompt' }] } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: at(2), message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'working' }] } },
    // A control record mid-turn, followed by a non-user message. This is the
    // case that punishes collecting only messages for the lineage: drop this
    // record and `t1` can no longer reach the user message that began its turn.
    { type: 'model_change', id: 'model-swap', parentId: 'a1', timestamp: at(3), model: 'other' },
    { type: 'message', id: 't1', parentId: 'model-swap', timestamp: at(3), message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'read', content: [{ type: 'text', text: 'file body' }] } },
    // Injected mid-turn. Its parent is a message, so it starts nothing.
    { type: 'message', id: 'steer', parentId: 't1', timestamp: at(4), message: { role: 'user', content: [{ type: 'text', text: 'actually skip that' }] } },
    { type: 'message', id: 'a2', parentId: 'steer', timestamp: at(5), message: { role: 'assistant', stopReason: 'aborted', content: [{ type: 'text', text: 'stopped' }] } },
    // Compaction before a user message: that message still begins a turn,
    // because its parent is not another message.
    { type: 'compaction', id: 'compact', parentId: 'a2', timestamp: at(6), summary: 'earlier work', firstKeptEntryId: 'a2' },
    { type: 'message', id: 'u2', parentId: 'compact', timestamp: at(7), message: { role: 'user', content: [{ type: 'text', text: 'second prompt' }] } },
    { type: 'message', id: 'a3', parentId: 'u2', timestamp: at(8), message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'done' }] } },
  ].map((entry) => JSON.stringify(entry));
}

async function withFixture(run: (provider: GjcSessionsProvider, transcriptPath: string) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'gjc-turns-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const sessionsDir = path.join(tempRoot, '.gjc', 'agent', 'sessions', '-workspace');
  const transcriptPath = path.join(sessionsDir, `${SESSION_ID}.jsonl`);
  const previousDatabasePath = process.env.DATABASE_PATH;

  await mkdir(workspacePath, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(transcriptPath, `${transcriptLines(workspacePath).join('\n')}\n`, 'utf8');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  await initializeDatabase();

  try {
    sessionsDb.createSession(SESSION_ID, 'gjc', workspacePath, undefined, undefined, undefined, transcriptPath);
    await run(new GjcSessionsProvider(), transcriptPath);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('history messages carry the turn they belong to', { concurrency: false }, async () => {
  await withFixture(async (provider) => {
    const history = await provider.fetchHistory(SESSION_ID, { limit: 100 });
    const messages = history.messages;
    assert.ok(messages.length > 0, 'the fixture should produce messages');

    const turnIds = new Set(messages.map((message) => message.turnId).filter(Boolean));
    assert.deepEqual(
      [...turnIds].sort(),
      ['u1', 'u2'],
      'two turns, not three - the steer must not have started one',
    );

    for (const message of messages) {
      assert.ok(message.turnId, `${message.id} reached the client without a turn`);
    }
  });
});

test('the turn reports how it ended, on every one of its messages', { concurrency: false }, async () => {
  await withFixture(async (provider) => {
    const history = await provider.fetchHistory(SESSION_ID, { limit: 100 });

    for (const message of history.messages) {
      const expected = message.turnId === 'u1' ? 'aborted' : 'completed';
      assert.equal(
        message.turnStatus,
        expected,
        `${message.id} in turn ${message.turnId} should report ${expected}`,
      );
    }
  });
});

test('history survives valid JSON values that are not transcript records', { concurrency: false }, async () => {
  await withFixture(async (provider, transcriptPath) => {
    await appendFile(transcriptPath, 'null\n[]\n123\n"text"\n{broken\n');
    const history = await provider.fetchHistory(SESSION_ID);

    assert.ok(history.messages.length > 0, 'one malformed record must not discard the entire conversation');
    assert.equal(history.messages[0]?.content, 'first prompt');
    assert.equal(history.messages.at(-1)?.content, 'done');
    assert.equal(history.messages.at(-1)?.turnId, 'u2');
  });
});

test('a resumed edit turn keeps its own identity and structured result on reload', { concurrency: false }, async () => {
  await withFixture(async (provider, transcriptPath) => {
    const details = { files: [{ path: 'second.ts', op: 'update', diff: '-1|old\n+1|new' }] };
    const records = [
      { type: 'message', id: 'u3', parentId: 'a3', message: { role: 'user', content: 'edit the second file' } },
      { type: 'message', id: 'a4', parentId: 'u3', message: { role: 'assistant', stopReason: 'toolUse', content: [
        { type: 'toolCall', id: 'edit-2', name: 'apply_patch', arguments: { patch: 'patch envelope' } },
      ] } },
      { type: 'message', id: 't2', parentId: 'a4', message: { role: 'toolResult', toolCallId: 'edit-2',
        content: [{ type: 'text', text: 'Updated second.ts' }], details } },
      { type: 'message', id: 'a5', parentId: 't2', message: { role: 'assistant', stopReason: 'stop', content: 'edited' } },
    ];
    await appendFile(transcriptPath, `${records.map((entry, index) => JSON.stringify({
      ...entry, timestamp: `2026-07-09T00:00:${10 + index}.000Z`,
    })).join('\n')}\n`);
    const history = await provider.fetchHistory(SESSION_ID);
    const edit = history.messages.find((message) => message.toolId === 'edit-2');

    assert.equal(edit?.turnId, 'u3');
    assert.equal(edit?.turnStatus, 'completed');
    assert.deepEqual(edit?.toolResult?.toolUseResult, details);
    assert.equal(history.messages.find((message) => message.content === 'second prompt')?.turnId, 'u2');
  });
});
