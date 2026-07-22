import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { runMigrations } from '@/modules/database/migrations.js';

type ProjectRow = {
  project_id: string;
  project_path: string;
  origin: string;
};

type ColumnInfo = {
  name: string;
  notnull: number;
  dflt_value: string | null;
};

const createProductionUsersTable = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME,
      is_active BOOLEAN DEFAULT 1
    )
  `);
};

const assertOriginColumn = (db: Database.Database): void => {
  const origin = (db.prepare('PRAGMA table_info(projects)').all() as ColumnInfo[]).find(
    (column) => column.name === 'origin',
  );

  assert.ok(origin);
  assert.equal(origin.notnull, 1);
  assert.equal(origin.dflt_value, "'legacy'");
};

test('project primary-key migration adds legacy origin to production-shape project rows', () => {
  const db = new Database(':memory:');
  try {
    createProductionUsersTable(db);
    db.exec(`
      CREATE TABLE projects (
        project_id TEXT PRIMARY KEY NOT NULL,
        project_path TEXT NOT NULL UNIQUE,
        custom_project_name TEXT DEFAULT NULL,
        isStarred BOOLEAN DEFAULT 0,
        isArchived BOOLEAN DEFAULT 0
      );
      INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived)
      VALUES ('existing-project', '/workspace/existing', 'Existing', 1, 0);
    `);

    runMigrations(db);

    assertOriginColumn(db);
    assert.deepEqual(
      db.prepare('SELECT project_id, project_path, origin FROM projects').all(),
      [{ project_id: 'existing-project', project_path: '/workspace/existing', origin: 'legacy' }],
    );
  } finally {
    db.close();
  }
});

test('project rebuild migration preserves valid origins and defaults nullable origins to legacy', () => {
  const db = new Database(':memory:');
  try {
    createProductionUsersTable(db);
    db.exec(`
      CREATE TABLE projects (
        project_id TEXT,
        project_path TEXT NOT NULL,
        custom_project_name TEXT DEFAULT NULL,
        isStarred BOOLEAN DEFAULT 0,
        isArchived BOOLEAN DEFAULT 0,
        origin TEXT
      );
      INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived, origin)
      VALUES
        ('explicit-project', '/workspace/explicit', 'Explicit', 1, 0, 'explicit'),
        ('auto-project', '/workspace/auto', NULL, 0, 0, 'auto'),
        ('legacy-project', '/workspace/legacy', NULL, 0, 1, NULL);
    `);

    runMigrations(db);

    assertOriginColumn(db);
    assert.deepEqual(
      db.prepare('SELECT project_id, project_path, origin FROM projects ORDER BY project_path').all() as ProjectRow[],
      [
        { project_id: 'auto-project', project_path: '/workspace/auto', origin: 'auto' },
        { project_id: 'explicit-project', project_path: '/workspace/explicit', origin: 'explicit' },
        { project_id: 'legacy-project', project_path: '/workspace/legacy', origin: 'legacy' },
      ],
    );
  } finally {
    db.close();
  }
});
