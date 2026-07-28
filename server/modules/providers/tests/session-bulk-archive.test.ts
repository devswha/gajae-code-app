import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

/*
 * Bulk archiving by idle age.
 *
 * Sessions accumulate with nothing to clear them — 232 transcripts over nine
 * days on the machine this was written for — and the only control was
 * archiving one at a time. The risk in adding a bulk operation is that it
 * takes more than the user was shown, so the preview and the action run the
 * same selection and these tests hold them to it.
 */

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'gjc-bulk-archive-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

function seedSession(sessionId: string, updatedAt: string): void {
  sessionsDb.createSession(
    sessionId,
    'gjc',
    '/tmp/project',
    sessionId,
    updatedAt,
    updatedAt,
    `/tmp/project/${sessionId}.jsonl`,
  );
}

const activeIds = (): string[] =>
  sessionsDb.getAllSessions().filter((row) => !row.isArchived).map((row) => row.session_id);

test('a dry run reports what would be archived and changes nothing', async () => {
  await withIsolatedDatabase(async () => {
    seedSession('old-1', daysAgo(40));
    seedSession('old-2', daysAgo(31));
    seedSession('fresh', daysAgo(2));

    const preview = sessionsService.archiveSessionsIdleFor(30, { dryRun: true });

    assert.equal(preview.dryRun, true);
    assert.equal(preview.matched, 2);
    assert.equal(preview.archived, 0, 'a dry run must not archive anything');
    assert.deepEqual(preview.sessions.map((session) => session.sessionId), ['old-1', 'old-2']);
    assert.deepEqual(activeIds().sort(), ['fresh', 'old-1', 'old-2']);
  });
});

test('the preview and the real run select exactly the same sessions', async () => {
  // The property that matters: the count shown cannot differ from the count
  // acted on, or the confirmation is a lie.
  await withIsolatedDatabase(async () => {
    seedSession('old-1', daysAgo(90));
    seedSession('old-2', daysAgo(45));
    seedSession('edge', daysAgo(29));
    seedSession('fresh', daysAgo(1));

    const preview = sessionsService.archiveSessionsIdleFor(30, { dryRun: true });
    const applied = sessionsService.archiveSessionsIdleFor(30);

    assert.deepEqual(
      applied.sessions.map((session) => session.sessionId),
      preview.sessions.map((session) => session.sessionId),
    );
    assert.equal(applied.archived, preview.matched);
    assert.deepEqual(activeIds().sort(), ['edge', 'fresh']);
  });
});

test('sessions younger than the window are never touched', async () => {
  await withIsolatedDatabase(async () => {
    seedSession('fresh-1', daysAgo(1));
    seedSession('fresh-2', daysAgo(29));

    const result = sessionsService.archiveSessionsIdleFor(30);

    assert.equal(result.archived, 0);
    assert.deepEqual(activeIds().sort(), ['fresh-1', 'fresh-2']);
  });
});

test('excluded sessions survive even when they match the window', async () => {
  // The route passes the supervisor's running set here. Archiving a session
  // with a turn in flight would pull it out of the sidebar mid-answer.
  await withIsolatedDatabase(async () => {
    seedSession('running', daysAgo(60));
    seedSession('idle', daysAgo(60));

    const result = sessionsService.archiveSessionsIdleFor(30, { excludeSessionIds: ['running'] });

    assert.deepEqual(result.sessions.map((session) => session.sessionId), ['idle']);
    assert.deepEqual(activeIds(), ['running']);
  });
});

test('already archived sessions are not re-counted', async () => {
  await withIsolatedDatabase(async () => {
    seedSession('old-1', daysAgo(60));
    seedSession('old-2', daysAgo(60));
    sessionsDb.updateSessionIsArchived('old-1', true);

    const result = sessionsService.archiveSessionsIdleFor(30);

    assert.equal(result.archived, 1, 'the already-archived row must not inflate the count');
    assert.deepEqual(result.sessions.map((session) => session.sessionId), ['old-2']);
  });
});

test('archiving is reversible and leaves the transcript alone', async () => {
  await withIsolatedDatabase(async () => {
    seedSession('old-1', daysAgo(60));
    const before = sessionsDb.getSessionById('old-1');

    sessionsService.archiveSessionsIdleFor(30);
    sessionsService.restoreSessionById('old-1');

    const after = sessionsDb.getSessionById('old-1');
    assert.equal(after?.isArchived, 0);
    assert.equal(after?.jsonl_path, before?.jsonl_path, 'the transcript path must be untouched');
  });
});

test('a non-positive window is refused rather than archiving everything', async () => {
  await withIsolatedDatabase(async () => {
    seedSession('old-1', daysAgo(60));

    for (const window of [0, -1, Number.NaN]) {
      assert.throws(() => sessionsService.archiveSessionsIdleFor(window), /positive number of days/);
    }
    assert.deepEqual(activeIds(), ['old-1']);
  });
});
