import { strict as assert } from 'node:assert';
import { mkdtemp as createEphemeralDirectory, rm as discardEphemeralDirectory } from 'node:fs/promises';
import { tmpdir as temporaryDirectoryRoot } from 'node:os';
import { join as composePath } from 'node:path';
import { test } from 'node:test';

import Database from 'better-sqlite3';

import {
  closeConnection as releaseDatabaseConnection,
  getDatabasePath as currentDatabasePath,
} from '@/modules/database/connection.js';
import { initializeDatabase as initializeSessionSchema } from '@/modules/database/init-db.js';
import { runMigrations as applyDatabaseMigrations } from '@/modules/database/migrations.js';
import { sessionsDb as sessionRepository } from '@/modules/database/repositories/sessions.db.js';

async function withSessionDatabase(action: () => void | Promise<void>): Promise<void> {
  const inheritedDatabasePath = process.env.DATABASE_PATH;
  const ephemeralStore = await createEphemeralDirectory(composePath(temporaryDirectoryRoot(), 'gajae-session-repository-'));

  releaseDatabaseConnection();
  process.env.DATABASE_PATH = composePath(ephemeralStore, 'gajae.sqlite');
  try {
    await initializeSessionSchema();
    await action();
  } finally {
    releaseDatabaseConnection();
    if (inheritedDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = inheritedDatabasePath;
    await discardEphemeralDirectory(ephemeralStore, { recursive: true, force: true });
  }
}

test('active project readers omit archived conversations while archival readers retain them', async () => {
  await withSessionDatabase(() => {
    const projectPath = '/workspaces/gajae/dashboard';
    const activeSessionId = 'claude-gajae-dashboard-active';
    const archivedSessionId = 'claude-gajae-dashboard-archived';
    sessionRepository.createSession(activeSessionId, 'claude', projectPath, 'Dashboard review');
    sessionRepository.createSession(archivedSessionId, 'claude', projectPath, 'Dashboard history');
    sessionRepository.updateSessionIsArchived(archivedSessionId, true);

    assert.deepEqual(sessionRepository.getAllSessions().map(({ session_id: id }) => id), [activeSessionId]);
    assert.deepEqual(sessionRepository.getArchivedSessions().map(({ session_id: id }) => id), [archivedSessionId]);
    assert.deepEqual(sessionRepository.getSessionsByProjectPath(projectPath).map(({ session_id: id }) => id), [activeSessionId]);
    assert.deepEqual(
      sessionRepository.getSessionsByProjectPathIncludingArchived(projectPath).map(({ session_id: id }) => id).sort(),
      [activeSessionId, archivedSessionId].sort(),
    );
    assert.equal(sessionRepository.countSessionsByProjectPath(projectPath), 1);
  });
});

test('rediscovery refreshes session details without reviving an archived conversation', async () => {
  await withSessionDatabase(() => {
    const projectPath = '/workspaces/gajae/dashboard';
    const refreshedSessionId = 'claude-gajae-refresh';
    sessionRepository.createSession(refreshedSessionId, 'claude', projectPath, 'Initial dashboard pass');
    sessionRepository.updateSessionIsArchived(refreshedSessionId, true);
    sessionRepository.createSession(refreshedSessionId, 'claude', projectPath, 'Refreshed dashboard pass');

    const refreshed = sessionRepository.getSessionById(refreshedSessionId);
    assert.deepEqual(
      {
        activeCount: sessionRepository.getAllSessions().length,
        archivedCount: sessionRepository.getArchivedSessions().length,
        sessionId: refreshed?.session_id,
        name: refreshed?.custom_name,
        archived: refreshed?.isArchived,
      },
      {
        activeCount: 0,
        archivedCount: 1,
        sessionId: refreshedSessionId,
        name: 'Refreshed dashboard pass',
        archived: 1,
      },
    );

    const providerChangedId = 'provider-gajae-refresh';
    sessionRepository.createSession(providerChangedId, 'claude', projectPath, 'Claude source');
    sessionRepository.updateSessionIsArchived(providerChangedId, true);
    sessionRepository.createSession(providerChangedId, 'codex', projectPath, 'Codex source');
    assert.deepEqual(
      sessionRepository.getSessionById(providerChangedId) && {
        provider: sessionRepository.getSessionById(providerChangedId)?.provider,
        name: sessionRepository.getSessionById(providerChangedId)?.custom_name,
        archived: sessionRepository.getSessionById(providerChangedId)?.isArchived,
      },
      { provider: 'codex', name: 'Codex source', archived: 1 },
    );
  });
});

test('stored application sessions expose UTC ISO timestamps', async () => {
  await withSessionDatabase(() => {
    sessionRepository.createAppSession('app-gajae-timestamp', 'claude', '/workspaces/gajae/dashboard');
    const session = sessionRepository.getSessionById('app-gajae-timestamp');

    for (const value of [session?.created_at, session?.updated_at]) {
      assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(value?.endsWith('Z'), true);
    }
  });
});

test('a session star is disabled initially and is reflected by id and project lookups', async () => {
  await withSessionDatabase(() => {
    const projectPath = '/workspaces/gajae/dashboard';
    const sessionId = 'claude-gajae-star';
    sessionRepository.createSession(sessionId, 'claude', projectPath, 'Starred dashboard work');
    assert.equal(sessionRepository.getSessionById(sessionId)?.isStarred, 0);

    sessionRepository.updateSessionIsStarred(sessionId, true);
    assert.deepEqual(
      [sessionRepository.getSessionById(sessionId)?.isStarred, sessionRepository.getSessionsByProjectPath(projectPath)[0]?.isStarred],
      [1, 1],
    );

    sessionRepository.updateSessionIsStarred(sessionId, false);
    assert.equal(sessionRepository.getSessionById(sessionId)?.isStarred, 0);
  });
});

test('repeated star migrations preserve existing star values and their default column', () => {
  const database = new Database(':memory:');
  try {
    database.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        is_active BOOLEAN DEFAULT 1
      );
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'claude',
        provider_session_id TEXT,
        custom_name TEXT,
        project_path TEXT,
        jsonl_path TEXT,
        isArchived BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO sessions (session_id, provider, project_path)
      VALUES ('existing-session', 'claude', '/workspace/demo-project');
    `);

    applyDatabaseMigrations(database);
    database.prepare('UPDATE sessions SET isStarred = 1 WHERE session_id = ?').run('existing-session');
    applyDatabaseMigrations(database);

    const starColumn = (database.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string; dflt_value: string | null }>)
      .filter(({ name }) => name === 'isStarred')
      .map(({ name, dflt_value: defaultValue }) => ({ name, defaultValue }));
    assert.deepEqual(starColumn, [{ name: 'isStarred', defaultValue: '0' }]);
    assert.deepEqual(
      database.prepare('SELECT isStarred FROM sessions WHERE session_id = ?').get('existing-session'),
      { isStarred: 1 },
    );
  } finally {
    database.close();
  }
});

test('repository initialization honors an isolated DATABASE_PATH', async () => {
  await withSessionDatabase(() => {
    const sessionId = 'claude-gajae-explicit-store';
    assert.equal(currentDatabasePath(), process.env.DATABASE_PATH);
    sessionRepository.createSession(sessionId, 'claude', '/workspaces/gajae/dashboard', 'Explicit store session');
    assert.equal(sessionRepository.getSessionById(sessionId)?.custom_name, 'Explicit store session');
  });
});
