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

async function withIsolatedDatabase(action: () => void | Promise<void>): Promise<void> {
  const inheritedPath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'sessions-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  try {
    await initializeDatabase();
    await action();
  } finally {
    closeConnection();
    if (inheritedPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = inheritedPath;
    await rm(directory, { recursive: true, force: true });
  }
}

test('archived sessions are excluded from active collection and project readers', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/demo-project';
    sessionsDb.createSession('session-active', 'claude', projectPath, 'Active Session');
    sessionsDb.createSession('session-archived', 'claude', projectPath, 'Archived Session');
    sessionsDb.updateSessionIsArchived('session-archived', true);

    assert.deepEqual(sessionsDb.getAllSessions().map(({ session_id: id }) => id), ['session-active']);
    assert.deepEqual(sessionsDb.getArchivedSessions().map(({ session_id: id }) => id), ['session-archived']);
    assert.deepEqual(sessionsDb.getSessionsByProjectPath(projectPath).map(({ session_id: id }) => id), ['session-active']);
    assert.deepEqual(
      sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath).map(({ session_id: id }) => id).sort(),
      ['session-active', 'session-archived'],
    );
    assert.equal(sessionsDb.countSessionsByProjectPath(projectPath), 1);
  });
});

test('refreshing a stored session changes metadata but retains its archived state', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/demo-project';
    sessionsDb.createSession('session-reused', 'claude', projectPath, 'First Name');
    sessionsDb.updateSessionIsArchived('session-reused', true);
    sessionsDb.createSession('session-reused', 'claude', projectPath, 'Updated Name');

    assert.equal(sessionsDb.getAllSessions().length, 0);
    assert.equal(sessionsDb.getArchivedSessions().length, 1);
    assert.equal(sessionsDb.getArchivedSessions()[0]?.session_id, 'session-reused');
    assert.equal(sessionsDb.getSessionById('session-reused')?.custom_name, 'Updated Name');
    assert.equal(sessionsDb.getSessionById('session-reused')?.isArchived, 1);

    sessionsDb.createSession('session-conflict', 'claude', projectPath, 'First Conflict Name');
    sessionsDb.updateSessionIsArchived('session-conflict', true);
    sessionsDb.createSession('session-conflict', 'codex', projectPath, 'Updated Conflict Name');
    const replacedProvider = sessionsDb.getSessionById('session-conflict');
    assert.equal(replacedProvider?.provider, 'codex');
    assert.equal(replacedProvider?.custom_name, 'Updated Conflict Name');
    assert.equal(replacedProvider?.isArchived, 1);
  });
});

test('repository session rows expose UTC timestamps as ISO strings', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-timezone', 'claude', '/workspace/demo-project');
    const result = sessionsDb.getSessionById('session-timezone');

    for (const timestamp of [result?.created_at, result?.updated_at]) {
      assert.match(timestamp ?? '', /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(timestamp?.endsWith('Z'), true);
    }
  });
});

test('star state starts disabled and is returned from identifier and project queries', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/demo-project';
    sessionsDb.createSession('session-starred', 'claude', projectPath, 'Starred Session');
    assert.equal(sessionsDb.getSessionById('session-starred')?.isStarred, 0);

    sessionsDb.updateSessionIsStarred('session-starred', true);
    assert.equal(sessionsDb.getSessionById('session-starred')?.isStarred, 1);
    assert.equal(sessionsDb.getSessionsByProjectPath(projectPath)[0]?.isStarred, 1);

    sessionsDb.updateSessionIsStarred('session-starred', false);
    assert.equal(sessionsDb.getSessionById('session-starred')?.isStarred, 0);
  });
});

test('the star migration can run repeatedly without losing existing star data', () => {
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

    runMigrations(database);
    database.prepare('UPDATE sessions SET isStarred = 1 WHERE session_id = ?').run('existing-session');
    runMigrations(database);

    const fields = database.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string; dflt_value: string | null }>;
    assert.deepEqual(
      fields.filter(({ name }) => name === 'isStarred').map(({ name, dflt_value: defaultValue }) => ({ name, defaultValue })),
      [{ name: 'isStarred', defaultValue: '0' }],
    );
    assert.deepEqual(
      database.prepare('SELECT isStarred FROM sessions WHERE session_id = ?').get('existing-session'),
      { isStarred: 1 },
    );
  } finally {
    database.close();
  }
});

test('an isolated repository uses its DATABASE_PATH override', async () => {
  await withIsolatedDatabase(() => {
    assert.equal(getDatabasePath(), process.env.DATABASE_PATH);
    sessionsDb.createSession('explicit-path', 'claude', '/workspace/demo-project', 'Explicit Path');
    assert.equal(sessionsDb.getSessionById('explicit-path')?.custom_name, 'Explicit Path');
  });
});
