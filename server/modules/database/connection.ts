import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';

import { APP_CONFIG_TABLE_SCHEMA_SQL } from '@/modules/database/schema.js';

const connectionState: { database: Database.Database | null } = { database: null };

const databasePath = (): string =>
  process.env.DATABASE_PATH || path.join(os.homedir(), '.gajae-app', 'auth.db');

const createParentDirectory = (filename: string): void => {
  const parent = path.dirname(filename);
  if (fs.existsSync(parent)) return;

  fs.mkdirSync(parent, { recursive: true });
  console.log('Created database directory:', parent);
};

const openDatabase = (): Database.Database => {
  const filename = databasePath();
  createParentDirectory(filename);

  const database = new Database(filename);
  database.exec(APP_CONFIG_TABLE_SCHEMA_SQL);
  return database;
};

export function getConnection(): Database.Database {
  connectionState.database ??= openDatabase();
  return connectionState.database;
}

export function getDatabasePath(): string {
  return databasePath();
}

export function closeConnection(): void {
  const database = connectionState.database;
  if (!database) return;

  database.close();
  connectionState.database = null;
  console.log('Database connection closed');
}
