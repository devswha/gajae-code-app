// The logical schema below is pinned by every user database already on disk:
// column names, types, defaults and constraints must not change meaning.
// Layout and the commentary are this file's own; SQLite ignores both.
const table = (definition: string): string => `\n${definition.trim()}\n`;

const USER_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, -- surrogate key, referenced everywhere below
      username TEXT NOT NULL UNIQUE, -- login identity
      password_hash TEXT NOT NULL, -- bcrypt output, never the raw password
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- account creation instant
      last_login DATETIME, -- null until the first successful login
      is_active BOOLEAN DEFAULT 1, -- soft-disable switch
      git_name TEXT, -- optional identity forwarded to git
      git_email TEXT -- optional identity forwarded to git
  );
`);

const API_KEYS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT, -- row identity
      user_id INTEGER NOT NULL, -- owning account
      key_name TEXT NOT NULL, -- user-facing label
      api_key TEXT NOT NULL UNIQUE, -- the bearer credential itself
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- issue instant
      last_used DATETIME, -- null until first use
      is_active BOOLEAN DEFAULT 1, -- revocation switch
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`);

const USER_CREDENTIALS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS user_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT, -- row identity
      user_id INTEGER NOT NULL, -- owning account
      credential_name TEXT NOT NULL, -- user-facing label
      credential_type TEXT NOT NULL, -- discriminator, e.g. github_token
      credential_value TEXT NOT NULL, -- the secret material
      description TEXT, -- optional free-form note
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- creation instant
      is_active BOOLEAN DEFAULT 1, -- revocation switch
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`);

export const USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS user_notification_preferences (
      user_id INTEGER PRIMARY KEY, -- one preference document per account
      preferences_json TEXT NOT NULL, -- the whole document, serialized
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- last write instant
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`);

export const NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS notification_channel_endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT, -- row identity
      user_id INTEGER NOT NULL, -- owning account
      channel TEXT NOT NULL, -- delivery channel, e.g. desktop
      endpoint_id TEXT NOT NULL, -- device identity within the channel
      label TEXT, -- optional user-facing device name
      metadata_json TEXT, -- platform, app version and similar
      enabled BOOLEAN DEFAULT 1, -- per-device mute switch
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- last successful delivery
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- registration instant
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- last registration refresh
      UNIQUE (user_id, channel, endpoint_id),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`);

export const PROJECTS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT NOT NULL PRIMARY KEY, -- stable identifier handed to the client
      project_path TEXT NOT NULL UNIQUE, -- absolute workspace path, the real identity
      custom_project_name TEXT DEFAULT NULL, -- user-chosen display name
      isStarred BOOLEAN DEFAULT 0, -- sidebar pin
      isArchived BOOLEAN DEFAULT 0, -- soft delete
      origin TEXT NOT NULL DEFAULT 'legacy' -- how the row came to exist
  );
`);

export const PROJECT_PERMISSIONS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS project_permissions (
      project_path TEXT NOT NULL PRIMARY KEY, -- one policy per project, keyed like sessions are
      mode TEXT NOT NULL DEFAULT 'ask' CHECK (mode IN ('ask', 'auto_edits', 'bypass')), -- how gated tools resolve
      allow_always_json TEXT NOT NULL DEFAULT '[]', -- JSON array of tool names approved with "Always allow"
      bypass_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (bypass_acknowledged IN (0, 1)), -- the one-time warning was accepted
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- last policy change
      FOREIGN KEY (project_path) REFERENCES projects (project_path)
          ON DELETE CASCADE
          ON UPDATE CASCADE
  );
`);

export const SESSIONS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT NOT NULL, -- app-side session identity
      provider TEXT NOT NULL DEFAULT 'claude', -- which agent owns the transcript
      provider_session_id TEXT, -- the provider's own identifier, when known
      custom_name TEXT, -- the sidebar title
      name_source TEXT, -- who set it: user | auto (runtime model) | derived (indexer heuristic)
      project_path TEXT, -- owning project, nullable for orphans
      jsonl_path TEXT, -- transcript location on disk
      isStarred INTEGER DEFAULT 0, -- sidebar pin
      isArchived BOOLEAN DEFAULT 0, -- soft delete
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- first sighting
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- last activity sighting
      PRIMARY KEY (session_id),
      FOREIGN KEY (project_path) REFERENCES projects (project_path)
          ON DELETE SET NULL
          ON UPDATE CASCADE
  );
`);

export const LAST_SCANNED_AT_SQL = table(`
  CREATE TABLE IF NOT EXISTS scan_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), -- singleton row
      last_scanned_at TIMESTAMP NULL -- watermark for provider directory scans
  );
`);

export const GJC_TERMINAL_NOTIFICATION_DISPATCHES_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS gjc_terminal_notification_dispatches (
      job_id TEXT NOT NULL, -- the terminal job the event belongs to
      event_id TEXT NOT NULL, -- unique per event within a job
      sequence INTEGER NOT NULL CHECK (sequence >= 1), -- ordering within the job
      run_id TEXT NOT NULL, -- the agent run that produced the event
      app_session_id TEXT, -- app session, when the run maps to one
      user_id INTEGER, -- recipient account, nullable for system events
      outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'aborted', 'interrupted')),
      status TEXT NOT NULL CHECK (status IN ('claimed', 'accepted', 'failed')),
      claim_token TEXT NOT NULL, -- fencing token for at-most-once delivery
      claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- claim instant
      accepted_at DATETIME, -- delivery acknowledgement instant
      failure TEXT, -- delivery error, when status is failed
      PRIMARY KEY (job_id, event_id),
      UNIQUE (job_id, sequence),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
  );
`);

export const GJC_TERMINAL_NOTIFICATION_SCAN_CURSORS_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS gjc_terminal_notification_scan_cursors (
      job_id TEXT PRIMARY KEY, -- one cursor per job
      last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0), -- highest sequence consumed
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP -- last cursor advance
  );
`);

export const GJC_TERMINAL_NOTIFICATION_META_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS gjc_terminal_notification_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1), -- singleton row
      initialized INTEGER NOT NULL DEFAULT 0 CHECK (initialized IN (0, 1))
  );
`);

export const APP_CONFIG_TABLE_SCHEMA_SQL = table(`
  CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY, -- configuration entry name
      value TEXT NOT NULL, -- serialized configuration value
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP -- first write instant
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
  PROJECT_PERMISSIONS_TABLE_SCHEMA_SQL,
  GJC_TERMINAL_NOTIFICATION_DISPATCHES_TABLE_SCHEMA_SQL,
  'CREATE INDEX IF NOT EXISTS idx_gjc_terminal_notification_dispatches_status_claimed_at ON gjc_terminal_notification_dispatches(status, claimed_at);',
  GJC_TERMINAL_NOTIFICATION_SCAN_CURSORS_TABLE_SCHEMA_SQL,
  GJC_TERMINAL_NOTIFICATION_META_TABLE_SCHEMA_SQL,
  LAST_SCANNED_AT_SQL,
  APP_CONFIG_TABLE_SCHEMA_SQL,
];

export const INIT_SCHEMA_SQL = `${statements.join('\n')}\n`;
