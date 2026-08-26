import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, getDatabasePath } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('session archive queries hide archived rows from active project views', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-active', 'claude', '/workspace/demo-project', 'Active Session');
    sessionsDb.createSession('session-archived', 'claude', '/workspace/demo-project', 'Archived Session');
    sessionsDb.updateSessionIsArchived('session-archived', true);

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const activeProjectSessions = sessionsDb.getSessionsByProjectPath('/workspace/demo-project');
    const allProjectSessions = sessionsDb.getSessionsByProjectPathIncludingArchived('/workspace/demo-project');

    assert.deepEqual(activeSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(archivedSessions.map((session) => session.session_id), ['session-archived']);
    assert.deepEqual(activeProjectSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(
      allProjectSessions.map((session) => session.session_id).sort(),
      ['session-active', 'session-archived'],
    );
    assert.equal(sessionsDb.countSessionsByProjectPath('/workspace/demo-project'), 1);
  });
});

test('createSession preserves archive state when refreshing existing sessions', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'First Name');
    sessionsDb.updateSessionIsArchived('session-reused', true);

    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'Updated Name');

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const refreshedSession = sessionsDb.getSessionById('session-reused');

    assert.equal(activeSessions.length, 0);
    assert.equal(archivedSessions.length, 1);
    assert.equal(archivedSessions[0]?.session_id, 'session-reused');
    assert.equal(refreshedSession?.custom_name, 'Updated Name');
    assert.equal(refreshedSession?.isArchived, 1);

    sessionsDb.createSession('session-conflict', 'claude', '/workspace/demo-project', 'First Conflict Name');
    sessionsDb.updateSessionIsArchived('session-conflict', true);

    sessionsDb.createSession('session-conflict', 'codex', '/workspace/demo-project', 'Updated Conflict Name');

    const conflictedSession = sessionsDb.getSessionById('session-conflict');
    assert.equal(conflictedSession?.provider, 'codex');
    assert.equal(conflictedSession?.custom_name, 'Updated Conflict Name');
    assert.equal(conflictedSession?.isArchived, 1);
  });
});

test('repository reads normalize SQLite UTC timestamps to ISO strings', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-timezone', 'claude', '/workspace/demo-project');

    const row = sessionsDb.getSessionById('session-timezone');
    assert.ok(row?.created_at.endsWith('Z'));
    assert.ok(row?.updated_at.endsWith('Z'));
    assert.match(row?.created_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.match(row?.updated_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('session stars default off, persist, and reach every session reader', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-starred', 'claude', '/workspace/demo-project', 'Starred Session');
    assert.equal(sessionsDb.getSessionById('session-starred')?.isStarred, 0);

    sessionsDb.updateSessionIsStarred('session-starred', true);

    // The sidebar reads sessions through the project listing, so a flag that
    // only the by-id reader returns would render as unpinned after a reload.
    assert.equal(sessionsDb.getSessionById('session-starred')?.isStarred, 1);
    assert.equal(sessionsDb.getSessionsByProjectPath('/workspace/demo-project')[0]?.isStarred, 1);

    sessionsDb.updateSessionIsStarred('session-starred', false);
    assert.equal(sessionsDb.getSessionById('session-starred')?.isStarred, 0);
  });
});

test('session-star migration is idempotent and preserves existing values', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
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

    runMigrations(db);
    db.prepare('UPDATE sessions SET isStarred = 1 WHERE session_id = ?').run('existing-session');
    runMigrations(db);

    const columns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{
      name: string;
      dflt_value: string | null;
    }>;
    const starredColumns = columns.filter((column) => column.name === 'isStarred');
    assert.equal(starredColumns.length, 1);
    assert.equal(starredColumns[0]?.dflt_value, '0');
    assert.deepEqual(
      db.prepare('SELECT isStarred FROM sessions WHERE session_id = ?').get('existing-session') as { isStarred: number },
      { isStarred: 1 },
    );
  } finally {
    db.close();
  }
});

test('sessionsDb uses the explicit DATABASE_PATH override', async () => {
  await withIsolatedDatabase(() => {
    assert.equal(getDatabasePath(), process.env.DATABASE_PATH);

    sessionsDb.createSession('explicit-path', 'claude', '/workspace/demo-project', 'Explicit Path');

    assert.equal(sessionsDb.getSessionById('explicit-path')?.custom_name, 'Explicit Path');
  });
});
