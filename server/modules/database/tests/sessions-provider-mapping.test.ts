import { strict as assert } from 'node:assert';
import { mkdtemp as createEphemeralDirectory, rm as discardEphemeralDirectory } from 'node:fs/promises';
import { tmpdir as temporaryDirectoryRoot } from 'node:os';
import { join as composePath } from 'node:path';
import { test } from 'node:test';

import { closeConnection as releaseDatabaseConnection } from '@/modules/database/connection.js';
import { initializeDatabase as initializeSessionSchema } from '@/modules/database/init-db.js';
import { sessionsDb as sessionRepository } from '@/modules/database/repositories/sessions.db.js';

async function inSessionStore(action: () => void | Promise<void>): Promise<void> {
  const inheritedDatabasePath = process.env.DATABASE_PATH;
  const ephemeralStore = await createEphemeralDirectory(composePath(temporaryDirectoryRoot(), 'gajae-provider-session-'));
  const databasePath = composePath(ephemeralStore, 'sessions.sqlite');

  releaseDatabaseConnection();
  process.env.DATABASE_PATH = databasePath;
  try {
    await initializeSessionSchema();
    await action();
  } finally {
    releaseDatabaseConnection();
    if (inheritedDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = inheritedDatabasePath;
    await discardEphemeralDirectory(ephemeralStore, { recursive: true, force: true });
  }
}

test('a discovered disk session is addressable through both provider and application keys', async () => {
  await inSessionStore(() => {
    const providerSessionId = 'claude-gajae-disk-01';
    const createdId = sessionRepository.createSession(providerSessionId,
    'claude',
    '/workspaces/gajae/client',
    'Gajae client review',);

    const records = [
      sessionRepository.getSessionById(createdId),
      sessionRepository.getSessionByProviderSessionId('claude', providerSessionId),
    ];
    assert.deepEqual(records.map((record) => record?.session_id), [providerSessionId, providerSessionId]);
    assert.deepEqual(records.map((record) => record?.provider_session_id), [providerSessionId, providerSessionId]);
  });
});

test('provider refresh updates an announced application session rather than creating a duplicate', async () => {
  await inSessionStore(() => {
    const appSessionId = 'app-gajae-announce-01';
    const providerSessionId = 'claude-gajae-discovery-01';
    sessionRepository.createAppSession(appSessionId, 'claude', '/workspaces/gajae/client');
    sessionRepository.assignProviderSessionId(appSessionId, 'claude', providerSessionId);

    const discoveredId = sessionRepository.createSession(providerSessionId,
    'claude',
    '/workspaces/gajae/client',
    'Client discovery refresh',
    undefined,
    undefined,
    '/var/lib/gajae/sessions/claude-gajae-discovery-01.jsonl',);
    const refreshed = sessionRepository.getSessionById(appSessionId);

    assert.equal(discoveredId, appSessionId);
    assert.equal(sessionRepository.getAllSessions().length, 1);
    assert.deepEqual(
      { providerSessionId: refreshed?.provider_session_id, transcriptPath: refreshed?.jsonl_path },
      {
        providerSessionId,
        transcriptPath: '/var/lib/gajae/sessions/claude-gajae-discovery-01.jsonl',
      },
    );
  });
});

test('announcing a provider id retains watcher metadata on the surviving application session', async () => {
  await inSessionStore(() => {
    const appSessionId = 'app-gajae-race-01';
    const providerSessionId = 'codex-gajae-watcher-01';
    sessionRepository.createAppSession(appSessionId, 'codex', '/workspaces/gajae/server');
    sessionRepository.createSession(providerSessionId,
    'codex',
    '/workspaces/gajae/server',
    'Watcher collected name',
    undefined,
    undefined,
    '/var/lib/gajae/sessions/codex-gajae-watcher-01.jsonl',);
    assert.equal(sessionRepository.getAllSessions().length, 2);

    sessionRepository.assignProviderSessionId(appSessionId, 'codex', providerSessionId);
    const remaining = sessionRepository.getAllSessions();

    // The application id is authoritative while watcher-created display metadata remains useful.
    assert.equal(remaining.length, 1);
    assert.deepEqual(
      remaining[0] && {
        sessionId: remaining[0].session_id,
        providerSessionId: remaining[0].provider_session_id,
        transcriptPath: remaining[0].jsonl_path,
        displayName: remaining[0].custom_name,
      },
      {
        sessionId: appSessionId,
        providerSessionId,
        transcriptPath: '/var/lib/gajae/sessions/codex-gajae-watcher-01.jsonl',
        displayName: 'Watcher collected name',
      },
    );
  });
});

test('the same provider identifier remains isolated by provider, including legacy-shaped records', async () => {
  await inSessionStore(() => {
    sessionRepository.createSession('opencode-gajae-history-01', 'opencode', '/workspaces/gajae/history');
    sessionRepository.createSession('shared-gajae-provider-01', 'claude', '/workspaces/gajae/client', 'Claude review');
    sessionRepository.createAppSession('app-gajae-codex-01', 'codex', '/workspaces/gajae/server');
    sessionRepository.assignProviderSessionId('app-gajae-codex-01', 'codex', 'shared-gajae-provider-01');

    assert.equal(sessionRepository.getSessionById('opencode-gajae-history-01')?.provider, 'opencode');
    const providerViews = [
      ['opencode', 'opencode-gajae-history-01'],
      ['claude', 'shared-gajae-provider-01'],
      ['codex', 'shared-gajae-provider-01'],
    ] as const;
    assert.deepEqual(
      providerViews.map(([provider, sessionId]) => sessionRepository.getSessionByProviderSessionId(provider, sessionId)?.session_id),
      ['opencode-gajae-history-01', 'shared-gajae-provider-01', 'app-gajae-codex-01'],
    );
    assert.equal(sessionRepository.getAllSessions().length, 3);
  });
});

test('an unknown application target fails without deleting its watcher-created session', async () => {
  await inSessionStore(() => {
    const removedAppId = 'app-gajae-deleted-01';
    const watcherSessionId = 'claude-gajae-watcher-survives-01';
    sessionRepository.createAppSession(removedAppId, 'claude', '/workspaces/gajae/client');
    sessionRepository.deleteSessionById(removedAppId);
    sessionRepository.createSession(watcherSessionId, 'claude', '/workspaces/gajae/client', 'Watcher session retained');

    assert.throws(
      () => sessionRepository.assignProviderSessionId(removedAppId, 'claude', watcherSessionId),
      /target session "app-gajae-deleted-01" for provider "claude" was not found/,
    );
    assert.equal(sessionRepository.getSessionById(watcherSessionId)?.session_id, watcherSessionId);
  });
});
