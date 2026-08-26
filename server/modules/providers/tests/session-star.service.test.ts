import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { AppError } from '@/shared/utils.js';

/**
 * Pinning is the only session mutation a user can trigger without opening the
 * session, so the toggle has to be authoritative on its own: the value it
 * returns is what the sidebar renders, and a caller that asks twice must land
 * back where it started rather than drifting.
 */

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'gjc-session-star-'));

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

test('toggling a session star flips the stored value and reports what it stored', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-starred', 'claude', '/workspace/demo-project', 'Starred Session');

    assert.deepEqual(sessionsService.toggleSessionStarById('session-starred'), {
      sessionId: 'session-starred',
      isStarred: true,
    });
    assert.equal(sessionsDb.getSessionById('session-starred')?.isStarred, 1);

    // The second call has to return to the original state, not accumulate.
    assert.deepEqual(sessionsService.toggleSessionStarById('session-starred'), {
      sessionId: 'session-starred',
      isStarred: false,
    });
    assert.equal(sessionsDb.getSessionById('session-starred')?.isStarred, 0);
  });
});

test('toggling a missing session fails like the sibling session mutations', async () => {
  await withIsolatedDatabase(() => {
    assert.throws(
      () => sessionsService.toggleSessionStarById('missing-session'),
      (error: unknown) =>
        error instanceof AppError
        && error.code === 'SESSION_NOT_FOUND'
        && error.statusCode === 404,
    );
  });
});
