import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeConnection, getConnection, initializeDatabase } from '@/modules/database/index.js';
import { createGjcTerminalNotificationAdapter } from '@/modules/notifications/services/gjc-terminal-notification-adapter.service.js';

import type { JobProjectionEvent } from '../../../../shared/gjc-job-projection-protocol.js';

let directory: string;

after(async () => {
  closeConnection();
  if (directory) await rm(directory, { recursive: true, force: true });
});

const terminal = (eventId = 'terminal-1', sequence = 1): JobProjectionEvent => ({
  eventId,
  sequence,
  payload: {
    schemaVersion: 1,
    kind: 'job_terminal',
    runId: 'run-1',
    appSessionId: 'session-1',
    outcome: 'succeeded',
    jobState: 'succeeded',
    reason: 'completed',
  },
});

const nonterminal: JobProjectionEvent = { eventId: 'progress-1', sequence: 1, payload: { kind: 'progress' } };

async function prepareDatabase(): Promise<void> {
  closeConnection();
  directory = await mkdtemp(join(tmpdir(), 'gjc-terminal-notification-'));
  process.env.DATABASE_PATH = join(directory, 'auth.db');
  await initializeDatabase();
  getConnection().prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'test', 'hash')").run();
}

test('claims a terminal event before notifying and never replays it', async () => {
  await prepareDatabase();
  const sent: unknown[] = [];
  const authority = {
    async list() { return [{ jobId: 'job-1', lastSequence: 0 }]; },
    async replayEvents() { return { events: [terminal()], nextCursor: undefined }; },
  };
  const adapter = createGjcTerminalNotificationAdapter({
    authority,
    resolveUserId: () => 1,
    notifications: {
      createNotificationEvent(event) { return event; },
      notifyUserIfEnabled(input) {
        const row = getConnection().prepare('SELECT status FROM gjc_terminal_notification_dispatches WHERE job_id = ? AND event_id = ?').get('job-1', 'terminal-1') as { status: string };
        assert.equal(row.status, 'claimed');
        sent.push(input.event);
      },
    },
  });

  assert.equal(adapter.onCommittedEvent('job-1', terminal()), 'accepted');
  assert.equal(adapter.onCommittedEvent('job-1', terminal()), 'deduped');
  await adapter.startupCatchUp();
  await adapter.startupCatchUp();
  assert.equal(sent.length, 1);
  const row = getConnection().prepare('SELECT status FROM gjc_terminal_notification_dispatches').get() as { status: string };
  assert.equal(row.status, 'accepted');
});

test('startup catch-up advances nonterminal cursors and dispatches later terminals once', async () => {
  await prepareDatabase();
  let sent = 0;
  const authority = {
    async list() { return [{ jobId: 'job-2', lastSequence: 0 }]; },
    async replayEvents({ after }: Record<string, unknown>) {
      if (Number(after) === 0) return { events: [nonterminal], nextCursor: 1 };
      if (Number(after) === 1) return { events: [terminal('terminal-2', 2)], nextCursor: undefined };
      return { events: [], nextCursor: undefined };
    },
  };
  const adapter = createGjcTerminalNotificationAdapter({
    authority,
    resolveUserId: () => 1,
    notifications: { createNotificationEvent(event) { return event; }, notifyUserIfEnabled() { sent += 1; } },
  });

  await adapter.startupCatchUp(); // baseline
  await adapter.startupCatchUp(); // recovery scan
  await adapter.startupCatchUp(); // restart scan
  assert.equal(sent, 1);
  const cursor = getConnection().prepare('SELECT last_sequence FROM gjc_terminal_notification_scan_cursors WHERE job_id = ?').get('job-2') as { last_sequence: number };
  assert.equal(cursor.last_sequence, 2);
});

test('failed and claimed dispatches are not retried by replay', async () => {
  await prepareDatabase();
  let attempts = 0;
  const authority = {
    async list() { return [{ jobId: 'job-3', lastSequence: 0 }]; },
    async replayEvents() { return { events: [terminal('terminal-3')], nextCursor: undefined }; },
  };
  const adapter = createGjcTerminalNotificationAdapter({
    authority,
    resolveUserId: () => 1,
    notifications: {
      createNotificationEvent(event) { return event; },
      notifyUserIfEnabled() { attempts += 1; throw new Error('offline'); },
    },
  });

  assert.equal(adapter.onCommittedEvent('job-3', terminal('terminal-3')), 'failed');
  await adapter.startupCatchUp();
  await adapter.startupCatchUp();
  assert.equal(attempts, 1);
  const row = getConnection().prepare('SELECT status FROM gjc_terminal_notification_dispatches WHERE job_id = ?').get('job-3') as { status: string };
  assert.equal(row.status, 'failed');
});

test('startup catch-up follows nextCursor across budget-truncated short pages', async () => {
  await prepareDatabase();
  const listCalls: Array<string | undefined> = [];
  const scanned: string[] = [];
  const authority = {
    // Budget-truncated pages: 2 short pages (length < limit) chained by
    // nextCursor; page length must NOT terminate the loop.
    async list(params?: Record<string, unknown>) {
      const afterCursor = params?.afterCursor as string | undefined;
      listCalls.push(afterCursor);
      if (!afterCursor) return { items: [{ jobId: 'job-a', lastSequence: 0 }], nextCursor: 'job-a' };
      if (afterCursor === 'job-a') return { items: [{ jobId: 'job-b', lastSequence: 0 }], nextCursor: 'job-b' };
      return { items: [], nextCursor: null };
    },
    async replayEvents(params: Record<string, unknown>) {
      scanned.push(String(params.jobId));
      return { events: [], nextCursor: undefined };
    },
  };
  const adapter = createGjcTerminalNotificationAdapter({
    authority,
    resolveUserId: () => 1,
    notifications: { createNotificationEvent(event) { return event; }, notifyUserIfEnabled() {} },
  });

  await adapter.startupCatchUp(); // baseline over every page
  assert.deepEqual(listCalls, [undefined, 'job-a', 'job-b']);
  const baseline = getConnection().prepare('SELECT COUNT(*) AS count FROM gjc_terminal_notification_scan_cursors').get() as { count: number };
  assert.equal(baseline.count, 2);
});
