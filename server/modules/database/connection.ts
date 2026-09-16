import nodeFs from 'fs';
import nodeOs from 'os';
import nodePath from 'path';

import SqliteDatabase from 'better-sqlite3';

import { APP_CONFIG_TABLE_SCHEMA_SQL } from '@/modules/database/schema.js';

// Keep the process-wide handle private so callers always share SQLite's lock state.
const connectionCache: { database: SqliteDatabase.Database | null } = { database: null };

function configuredDatabasePath(): string {
  return process.env.DATABASE_PATH || nodePath.join(nodeOs.homedir(), '.gajae-app', 'auth.db');
}

function ensureDatabaseParent(filename: string): void {
  const directory = nodePath.dirname(filename);
  if (nodeFs.existsSync(directory)) return;

  nodeFs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  console.log('Created database directory:', directory);
}

/**
 * This file holds GitHub tokens and API keys in plaintext, and SQLite creates
 * it with the process umask - typically world-readable. Another account on the
 * machine, a backup or a copied home directory would then be enough. Encryption
 * at rest is a separate question; the mode is the part that must never be laxer
 * than the owner. Windows ignores POSIX modes, and a failure here must not stop
 * the app from opening its own database.
 */
function restrictToOwner(filename: string): void {
  if (process.platform === 'win32') return;
  for (const target of [filename, `${filename}-wal`, `${filename}-shm`]) {
    try {
      if (nodeFs.existsSync(target)) nodeFs.chmodSync(target, 0o600);
    } catch (error) {
      console.warn('Could not restrict database file permissions:', target, error);
    }
  }
}

function connect(): SqliteDatabase.Database {
  const filename = configuredDatabasePath();
  ensureDatabaseParent(filename);

  const db = new SqliteDatabase(filename);
  restrictToOwner(filename);
  db.exec(APP_CONFIG_TABLE_SCHEMA_SQL);
  restrictToOwner(filename);
  return db;
}

export function getConnection(): SqliteDatabase.Database {
  if (connectionCache.database === null) connectionCache.database = connect();
  return connectionCache.database;
}

export function getDatabasePath(): string {
  return configuredDatabasePath();
}

export function closeConnection(): void {
  const activeConnection = connectionCache.database;
  if (activeConnection === null) return;

  activeConnection.close();
  connectionCache.database = null;
  console.log('Database connection closed');
}
