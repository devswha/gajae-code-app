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

  nodeFs.mkdirSync(directory, { recursive: true });
  console.log('Created database directory:', directory);
}

function connect(): SqliteDatabase.Database {
  const filename = configuredDatabasePath();
  ensureDatabaseParent(filename);

  const db = new SqliteDatabase(filename);
  db.exec(APP_CONFIG_TABLE_SCHEMA_SQL);
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
