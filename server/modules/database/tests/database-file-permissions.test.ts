import { strict as assert } from 'node:assert';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';

/*
 * auth.db keeps GitHub tokens and API keys in plaintext. SQLite creates it with
 * the process umask, which on a normal install means every account on the
 * machine can read it. Encryption at rest is a separate question; the mode is
 * the part that must never be laxer than the owner.
 */

test('the database and its journals are readable only by their owner', { skip: process.platform === 'win32' ? 'POSIX modes only' : false }, async () => {
  const originalDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'gajae-db-permissions-'));
  const filename = path.join(directory, 'auth.db');
  closeConnection();
  process.env.DATABASE_PATH = filename;
  try {
    const database = getConnection();
    database.exec('CREATE TABLE IF NOT EXISTS probe (value TEXT)');
    database.prepare('INSERT INTO probe (value) VALUES (?)').run('ghp_secret');
    for (const target of [filename, `${filename}-wal`, `${filename}-shm`]) {
      const stats = await stat(target).catch(() => null);
      if (!stats) continue;
      assert.equal(stats.mode & 0o777, 0o600, `${target} is ${(stats.mode & 0o777).toString(8)}`);
    }
  } finally {
    closeConnection();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    await rm(directory, { recursive: true, force: true });
  }
});
