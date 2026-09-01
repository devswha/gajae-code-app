const table = (definition: string): string => `\n${definition.trim()}\n`;

const USER_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1,
    git_name TEXT,
    git_email TEXT
  );
`);

export const API_KEYS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

export const USER_CREDENTIALS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS user_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_name TEXT NOT NULL,
    credential_type TEXT NOT NULL,
    credential_value TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

export const USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS user_notification_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

export const NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS notification_channel_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    label TEXT,
    metadata_json TEXT,
    enabled BOOLEAN DEFAULT 1,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, channel, endpoint_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

export const PROJECTS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    project_path TEXT NOT NULL UNIQUE,
    custom_project_name TEXT DEFAULT NULL,
    isStarred BOOLEAN DEFAULT 0,
    isArchived BOOLEAN DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'legacy'
  );
`);

export const SESSIONS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    provider_session_id TEXT,
    custom_name TEXT,
    project_path TEXT,
    jsonl_path TEXT,
    isStarred INTEGER DEFAULT 0,
    isArchived BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id),
    FOREIGN KEY (project_path) REFERENCES projects(project_path)
      ON DELETE SET NULL
      ON UPDATE CASCADE
  );
`);

export const LAST_SCANNED_AT_SQL = table(`
  CREATE TABLE IF NOT EXISTS scan_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_scanned_at TIMESTAMP NULL
  );
`);

export const GJC_TERMINAL_NOTIFICATION_DISPATCHES_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS gjc_terminal_notification_dispatches (
    job_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    run_id TEXT NOT NULL,
    app_session_id TEXT,
    user_id INTEGER,
    outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'aborted', 'interrupted')),
    status TEXT NOT NULL CHECK (status IN ('claimed', 'accepted', 'failed')),
    claim_token TEXT NOT NULL,
    claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at DATETIME,
    failure TEXT,
    PRIMARY KEY (job_id, event_id),
    UNIQUE (job_id, sequence),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
`);

export const GJC_TERMINAL_NOTIFICATION_SCAN_CURSORS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS gjc_terminal_notification_scan_cursors (
    job_id TEXT PRIMARY KEY,
    last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

export const GJC_TERMINAL_NOTIFICATION_META_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS gjc_terminal_notification_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    initialized INTEGER NOT NULL DEFAULT 0 CHECK (initialized IN (0, 1))
  );
`);

export const APP_CONFIG_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const statements = [
  'PRAGMA foreign_keys = ON;',
  USER_TABLE_SCHEMA_SQL,
  'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);',
  'CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);',
  API_KEYS_TABLE_SCHEMA_SQL,
  'CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);',
  'CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);',
  'CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);',
  USER_CREDENTIALS_TABLE_SCHEMA_SQL,
  'CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);',
  'CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);',
  'CREATE INDEX IF NOT EXISTS idx_user_credentials_active ON user_credentials(is_active);',
  USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL,
  'CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_user_id ON user_notification_preferences(user_id);',
  NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL,
  'CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_user_channel ON notification_channel_endpoints(user_id, channel);',
  'CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_enabled ON notification_channel_endpoints(enabled);',
  PROJECTS_TABLE_SCHEMA_SQL,
  SESSIONS_TABLE_SCHEMA_SQL,
  'CREATE INDEX IF NOT EXISTS idx_session_ids_lookup ON sessions(session_id);',
  GJC_TERMINAL_NOTIFICATION_DISPATCHES_TABLE_SCHEMA_SQL,
  'CREATE INDEX IF NOT EXISTS idx_gjc_terminal_notification_dispatches_status_claimed_at ON gjc_terminal_notification_dispatches(status, claimed_at);',
  GJC_TERMINAL_NOTIFICATION_SCAN_CURSORS_TABLE_SCHEMA_SQL,
  GJC_TERMINAL_NOTIFICATION_META_TABLE_SCHEMA_SQL,
  LAST_SCANNED_AT_SQL,
  APP_CONFIG_TABLE_SCHEMA_SQL,
];

export const INIT_SCHEMA_SQL = `${statements.join('\n')}\n`;
