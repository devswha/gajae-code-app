import { Database } from 'better-sqlite3';

import {
  APP_CONFIG_TABLE_SCHEMA_SQL,
  GJC_TERMINAL_NOTIFICATION_DISPATCHES_TABLE_SCHEMA_SQL,
  GJC_TERMINAL_NOTIFICATION_META_TABLE_SCHEMA_SQL,
  GJC_TERMINAL_NOTIFICATION_SCAN_CURSORS_TABLE_SCHEMA_SQL,
  LAST_SCANNED_AT_SQL,
  NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL,
  PROJECTS_TABLE_SCHEMA_SQL,
  SESSIONS_TABLE_SCHEMA_SQL,
  USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL,
} from '@/modules/database/schema.js';

type Column = { name: string; pk: number };
type Migration = (database: Database) => void;

const uuid = `
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(6)))
`;

function columnsOf(database: Database, table: string): Column[] {
  return database.prepare(`PRAGMA table_info(${table})`).all() as Column[];
}

function hasTable(database: Database, table: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function addMissingColumn(database: Database, table: string, known: Set<string>, name: string, declaration: string): void {
  if (known.has(name)) return;
  console.log(`Running migration: Adding ${name} column to ${table} table`);
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
  known.add(name);
}

function withoutForeignKeyChecks(database: Database, work: () => void): void {
  database.exec('PRAGMA foreign_keys = OFF');
  try {
    database.exec('BEGIN TRANSACTION');
    work();
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

function upgradeProjectTable(database: Database): void {
  if (!hasTable(database, 'projects')) {
    database.exec(PROJECTS_TABLE_SCHEMA_SQL);
    return;
  }

  const info = columnsOf(database, 'projects');
  const names = new Set(info.map(({ name }) => name));
  if (info.some(({ name, pk }) => name === 'project_id' && pk === 1)) {
    addMissingColumn(database, 'projects', names, 'custom_project_name', 'TEXT DEFAULT NULL');
    addMissingColumn(database, 'projects', names, 'isStarred', 'BOOLEAN DEFAULT 0');
    addMissingColumn(database, 'projects', names, 'isArchived', 'BOOLEAN DEFAULT 0');
    addMissingColumn(database, 'projects', names, 'origin', "TEXT NOT NULL DEFAULT 'legacy'");
    database.exec(`UPDATE projects SET project_id = ${uuid} WHERE project_id IS NULL OR trim(project_id) = ''`);
    return;
  }

  console.log('Running migration: Rebuilding projects table to enforce project_id primary key');
  const pathColumn = names.has('project_path') ? 'project_path' : names.has('workspace_path') ? 'workspace_path' : 'NULL';
  const titleColumn = names.has('custom_project_name') ? 'custom_project_name' : names.has('custom_workspace_name') ? 'custom_workspace_name' : 'NULL';
  const starred = names.has('isStarred') ? 'COALESCE(isStarred, 0)' : '0';
  const archived = names.has('isArchived') ? 'COALESCE(isArchived, 0)' : '0';
  const origin = names.has('origin') ? "COALESCE(origin, 'legacy')" : "'legacy'";
  const identifier = names.has('project_id')
    ? `CASE WHEN project_id IS NULL OR trim(project_id) = '' THEN ${uuid} ELSE project_id END`
    : uuid;

  withoutForeignKeyChecks(database, () => {
    database.exec('DROP TABLE IF EXISTS projects__new');
    database.exec(`
      CREATE TABLE projects__new (
        project_id TEXT PRIMARY KEY NOT NULL,
        project_path TEXT NOT NULL UNIQUE,
        custom_project_name TEXT DEFAULT NULL,
        isStarred BOOLEAN DEFAULT 0,
        isArchived BOOLEAN DEFAULT 0,
        origin TEXT NOT NULL DEFAULT 'legacy'
      )
    `);
    database.exec(`
      WITH source_rows AS (
        SELECT ${pathColumn} AS project_path, ${titleColumn} AS custom_project_name,
          ${starred} AS isStarred, ${archived} AS isArchived, ${origin} AS origin,
          ${identifier} AS candidate_project_id, rowid AS source_rowid
        FROM projects
        WHERE ${pathColumn} IS NOT NULL AND trim(${pathColumn}) <> ''
      ), deduped_paths AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY project_path ORDER BY source_rowid) AS project_path_rank
        FROM source_rows
      ), prepared_rows AS (
        SELECT CASE WHEN ROW_NUMBER() OVER (PARTITION BY candidate_project_id ORDER BY source_rowid) = 1
          THEN candidate_project_id ELSE ${uuid} END AS project_id,
          project_path, custom_project_name, isStarred, isArchived, origin
        FROM deduped_paths WHERE project_path_rank = 1
      )
      INSERT INTO projects__new (project_id, project_path, custom_project_name, isStarred, isArchived, origin)
      SELECT project_id, project_path, custom_project_name, isStarred, isArchived, origin FROM prepared_rows
    `);
    database.exec('DROP TABLE projects');
    database.exec('ALTER TABLE projects__new RENAME TO projects');
  });
}

function importLegacyProjects(database: Database): void {
  database.exec(PROJECTS_TABLE_SCHEMA_SQL);
  if (!hasTable(database, 'workspace_original_paths')) return;

  console.log('Running migration: Migrating workspace_original_paths data into projects');
  database.exec(`
    INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived)
    SELECT CASE WHEN workspace_id IS NULL OR trim(workspace_id) = '' THEN ${uuid} ELSE workspace_id END,
      workspace_path, custom_workspace_name, COALESCE(isStarred, 0), 0
    FROM workspace_original_paths
    WHERE workspace_path IS NOT NULL AND trim(workspace_path) <> ''
    ON CONFLICT(project_path) DO UPDATE SET
      custom_project_name = COALESCE(projects.custom_project_name, excluded.custom_project_name),
      isStarred = COALESCE(projects.isStarred, excluded.isStarred)
  `);
}

function upgradeSessionTable(database: Database): void {
  if (!hasTable(database, 'sessions')) {
    database.exec(SESSIONS_TABLE_SCHEMA_SQL);
    return;
  }

  const info = columnsOf(database, 'sessions');
  const names = new Set(info.map(({ name }) => name));
  const keys = info.filter(({ pk }) => pk > 0).sort((left, right) => left.pk - right.pk).map(({ name }) => name);
  const requiresReplacement = !names.has('project_path') || !names.has('provider') || keys.length !== 1 || keys[0] !== 'session_id';
  if (!requiresReplacement) {
    addMissingColumn(database, 'sessions', names, 'jsonl_path', 'TEXT');
    addMissingColumn(database, 'sessions', names, 'isStarred', 'INTEGER DEFAULT 0');
    addMissingColumn(database, 'sessions', names, 'isArchived', 'BOOLEAN DEFAULT 0');
    addMissingColumn(database, 'sessions', names, 'created_at', 'DATETIME');
    addMissingColumn(database, 'sessions', names, 'updated_at', 'DATETIME');
    database.exec('UPDATE sessions SET isArchived = COALESCE(isArchived, 0)');
    database.exec('UPDATE sessions SET isStarred = COALESCE(isStarred, 0)');
    database.exec('UPDATE sessions SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP)');
    database.exec('UPDATE sessions SET updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)');
    return;
  }

  console.log('Running migration: Rebuilding sessions table to project-based schema');
  const project = names.has('project_path') ? 'project_path' : names.has('workspace_path') ? 'workspace_path' : 'NULL';
  const provider = names.has('provider') ? "COALESCE(provider, 'claude')" : "'claude'";
  const customName = names.has('custom_name') ? 'custom_name' : 'NULL';
  const jsonl = names.has('jsonl_path') ? 'jsonl_path' : 'NULL';
  const starred = names.has('isStarred') ? 'COALESCE(isStarred, 0)' : '0';
  const archived = names.has('isArchived') ? 'COALESCE(isArchived, 0)' : '0';
  const created = names.has('created_at') ? 'COALESCE(created_at, CURRENT_TIMESTAMP)' : 'CURRENT_TIMESTAMP';
  const updated = names.has('updated_at') ? 'COALESCE(updated_at, CURRENT_TIMESTAMP)' : 'CURRENT_TIMESTAMP';

  withoutForeignKeyChecks(database, () => {
    database.exec('DROP TABLE IF EXISTS sessions__new');
    database.exec(`
      CREATE TABLE sessions__new (
        session_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'claude', custom_name TEXT,
        project_path TEXT, jsonl_path TEXT, isStarred INTEGER DEFAULT 0, isArchived BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id), FOREIGN KEY (project_path) REFERENCES projects(project_path)
        ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    database.exec(`
      WITH source_rows AS (
        SELECT session_id, ${provider} AS provider, ${customName} AS custom_name,
          ${project} AS project_path, ${jsonl} AS jsonl_path, ${starred} AS isStarred,
          ${archived} AS isArchived, ${created} AS created_at, ${updated} AS updated_at,
          rowid AS source_rowid
        FROM sessions WHERE session_id IS NOT NULL AND trim(session_id) <> ''
      ), ranked_rows AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY session_id ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, source_rowid DESC
        ) AS session_rank FROM source_rows
      )
      INSERT INTO sessions__new (session_id, provider, custom_name, project_path, jsonl_path, isStarred, isArchived, created_at, updated_at)
      SELECT session_id, provider, custom_name, project_path, jsonl_path, isStarred, isArchived, created_at, updated_at
      FROM ranked_rows WHERE session_rank = 1
    `);
    database.exec('DROP TABLE sessions');
    database.exec('ALTER TABLE sessions__new RENAME TO sessions');
  });
}

function mergeLegacySessionNames(database: Database): void {
  if (!hasTable(database, 'session_names')) return;
  if (!hasTable(database, 'sessions')) {
    console.log('Running migration: Renaming session_names table to sessions');
    database.exec('ALTER TABLE session_names RENAME TO sessions');
    return;
  }

  console.log('Running migration: Merging session_names into sessions');
  database.exec(`
    INSERT INTO sessions (session_id, provider, custom_name, created_at, updated_at)
    SELECT session_id, COALESCE(provider, 'claude'), custom_name,
      COALESCE(created_at, CURRENT_TIMESTAMP), COALESCE(updated_at, CURRENT_TIMESTAMP)
    FROM session_names WHERE true
    ON CONFLICT(session_id) DO UPDATE SET
      provider = excluded.provider,
      custom_name = COALESCE(excluded.custom_name, sessions.custom_name),
      created_at = COALESCE(sessions.created_at, excluded.created_at),
      updated_at = COALESCE(excluded.updated_at, sessions.updated_at)
  `);
  database.exec('DROP TABLE session_names');
}

function addProviderMapping(database: Database): void {
  const names = new Set(columnsOf(database, 'sessions').map(({ name }) => name));
  addMissingColumn(database, 'sessions', names, 'provider_session_id', 'TEXT');
  database.exec('UPDATE sessions SET provider_session_id = session_id WHERE provider_session_id IS NULL');
}

function addProjectsForSessions(database: Database): void {
  if (!hasTable(database, 'sessions')) return;
  database.exec(`
    INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived)
    SELECT ${uuid}, project_path, NULL, 0, 0 FROM sessions
    WHERE project_path IS NOT NULL AND trim(project_path) <> ''
    ON CONFLICT(project_path) DO NOTHING
  `);
}

const migrations: Migration[] = [
  (database) => {
    const users = new Set(columnsOf(database, 'users').map(({ name }) => name));
    addMissingColumn(database, 'users', users, 'git_name', 'TEXT');
    addMissingColumn(database, 'users', users, 'git_email', 'TEXT');
  },
  (database) => {
    for (const statement of [
      APP_CONFIG_TABLE_SCHEMA_SQL,
      USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL,
      NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL,
      'CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_user_channel ON notification_channel_endpoints(user_id, channel)',
      'CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_enabled ON notification_channel_endpoints(enabled)',
      GJC_TERMINAL_NOTIFICATION_DISPATCHES_TABLE_SCHEMA_SQL,
      'CREATE INDEX IF NOT EXISTS idx_gjc_terminal_notification_dispatches_status_claimed_at ON gjc_terminal_notification_dispatches(status, claimed_at)',
      GJC_TERMINAL_NOTIFICATION_SCAN_CURSORS_TABLE_SCHEMA_SQL,
      GJC_TERMINAL_NOTIFICATION_META_TABLE_SCHEMA_SQL,
    ]) database.exec(statement);
  },
  (database) => { database.exec(PROJECTS_TABLE_SCHEMA_SQL); upgradeProjectTable(database); },
  importLegacyProjects,
  upgradeSessionTable,
  mergeLegacySessionNames,
  addProviderMapping,
  addProjectsForSessions,
  (database) => {
    for (const statement of [
      'CREATE INDEX IF NOT EXISTS idx_session_ids_lookup ON sessions(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_provider_session_id ON sessions(provider_session_id)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_provider_provider_session_id ON sessions(provider, provider_session_id)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_is_archived ON sessions(isArchived)',
      'CREATE INDEX IF NOT EXISTS idx_projects_is_starred ON projects(isStarred)',
      'CREATE INDEX IF NOT EXISTS idx_projects_is_archived ON projects(isArchived)',
      'DROP INDEX IF EXISTS idx_session_names_lookup',
      'DROP INDEX IF EXISTS idx_sessions_workspace_path',
      'DROP INDEX IF EXISTS idx_workspace_original_paths_is_starred',
      'DROP INDEX IF EXISTS idx_workspace_original_paths_workspace_id',
    ]) database.exec(statement);
    if (hasTable(database, 'workspace_original_paths')) {
      console.log('Running migration: Dropping legacy workspace_original_paths table');
      database.exec('DROP TABLE workspace_original_paths');
    }
    database.exec(LAST_SCANNED_AT_SQL);
  },
];

export const runMigrations = (db: Database): void => {
  try {
    for (const migration of migrations) migration(db);
    console.log('Database migrations completed successfully');
  } catch (error: any) {
    console.error('Error running migrations:', error.message);
    throw error;
  }
};
