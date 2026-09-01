import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(action: () => void | Promise<void>): Promise<void> {
  const originalPath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'sessions-mapping-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  try {
    await initializeDatabase();
    await action();
  } finally {
    closeConnection();
    if (originalPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  }
}

test('a disk session uses its provider identifier as both session keys', async () => {
  await withIsolatedDatabase(() => {
    const id = sessionsDb.createSession('provider-abc', 'claude', '/workspace/demo', 'From Disk');
    const direct = sessionsDb.getSessionById(id);
    const mapped = sessionsDb.getSessionByProviderSessionId('claude', 'provider-abc');

    assert.equal(id, 'provider-abc');
    assert.equal(direct?.session_id, 'provider-abc');
    assert.equal(direct?.provider_session_id, 'provider-abc');
    assert.equal(mapped?.session_id, 'provider-abc');
  });
});

test('provider discovery refreshes an announced app session instead of adding a row', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-id-1', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-id-1', 'claude', 'provider-xyz');

    const returnedId = sessionsDb.createSession(
      'provider-xyz',
      'claude',
      '/workspace/demo',
      'Synced Name',
      undefined,
      undefined,
      '/fake/path/provider-xyz.jsonl',
    );
    const stored = sessionsDb.getSessionById('app-id-1');

    assert.equal(returnedId, 'app-id-1');
    assert.equal(sessionsDb.getAllSessions().length, 1);
    assert.equal(stored?.provider_session_id, 'provider-xyz');
    assert.equal(stored?.jsonl_path, '/fake/path/provider-xyz.jsonl');
  });
});

test('announcing an id folds an existing watcher record into its app record', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-id-2', 'codex', '/workspace/demo');
    sessionsDb.createSession(
      'provider-race',
      'codex',
      '/workspace/demo',
      'Watcher Name',
      undefined,
      undefined,
      '/fake/provider-race.jsonl',
    );
    assert.equal(sessionsDb.getAllSessions().length, 2);

    sessionsDb.assignProviderSessionId('app-id-2', 'codex', 'provider-race');
    const [survivor] = sessionsDb.getAllSessions();

    assert.equal(sessionsDb.getAllSessions().length, 1);
    assert.equal(survivor?.session_id, 'app-id-2');
    assert.equal(survivor?.provider_session_id, 'provider-race');
    assert.equal(survivor?.jsonl_path, '/fake/provider-race.jsonl');
    assert.equal(survivor?.custom_name, 'Watcher Name');
  });
});

test('provider mappings remain provider-scoped, including legacy rows', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('legacy-1', 'opencode', '/workspace/demo');
    assert.equal(sessionsDb.getSessionById('legacy-1')?.provider, 'opencode');
    assert.equal(sessionsDb.getSessionByProviderSessionId('opencode', 'legacy-1')?.session_id, 'legacy-1');

    sessionsDb.createSession('shared-provider-id', 'claude', '/workspace/claude', 'Claude Session');
    sessionsDb.createAppSession('codex-app-id', 'codex', '/workspace/codex');
    sessionsDb.assignProviderSessionId('codex-app-id', 'codex', 'shared-provider-id');

    assert.equal(sessionsDb.getSessionByProviderSessionId('claude', 'shared-provider-id')?.session_id, 'shared-provider-id');
    assert.equal(sessionsDb.getSessionByProviderSessionId('codex', 'shared-provider-id')?.session_id, 'codex-app-id');
    assert.equal(sessionsDb.getAllSessions().length, 3);
  });
});

test('an absent target raises without removing its watcher session', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('deleted-app-id', 'claude', '/workspace/demo');
    sessionsDb.deleteSessionById('deleted-app-id');
    sessionsDb.createSession('watcher-session-id', 'claude', '/workspace/demo', 'Watcher Session');

    assert.throws(
      () => sessionsDb.assignProviderSessionId('deleted-app-id', 'claude', 'watcher-session-id'),
      /target session "deleted-app-id" for provider "claude" was not found/,
    );
    assert.equal(sessionsDb.getSessionById('watcher-session-id')?.session_id, 'watcher-session-id');
  });
});
