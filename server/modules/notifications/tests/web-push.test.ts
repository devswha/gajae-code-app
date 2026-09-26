import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appConfigDb,
  closeConnection,
  initializeDatabase,
  notificationChannelEndpointsDb,
  notificationPreferencesDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import { notifyRunStopped as notifyRunStoppedUntyped } from '@/modules/notifications/services/notification-orchestrator.service.js';
import {
  CHANNEL_WEB_PUSH,
  configureWebPushTransport,
  getVapidKeys,
  parseWebPushSubscription,
  sendWebPushNotification,
  type WebPushSubscription,
} from '@/modules/notifications/services/web-push.service.js';

// The orchestrator is JavaScript; its `sessionId = null` default infers `null` in TypeScript.
const notifyRunStopped = notifyRunStoppedUntyped as (input: { userId: number; provider: string; sessionId: string | null; stopReason?: string }) => Promise<unknown> | undefined;
type Sent = { subscription: WebPushSubscription; payload: unknown; options: { TTL: number; urgency: string; vapidDetails: { subject: string; publicKey: string; privateKey: string } } };

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'web-push-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    await runTest();
  } finally {
    configureWebPushTransport(null);
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function subscription(endpoint: string): WebPushSubscription {
  return { endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } };
}

function subscribe(userId: number, endpoint: string) {
  return notificationChannelEndpointsDb.upsertEndpoint({
    userId, channel: CHANNEL_WEB_PUSH, endpointId: endpoint, metadata: { keys: subscription(endpoint).keys }, enabled: true,
  });
}

function fakeTransport(failures: Map<string, number> = new Map()) {
  const sent: Sent[] = [];
  configureWebPushTransport({
    async sendNotification(target, payload, options) {
      const statusCode = failures.get(target.endpoint);
      if (statusCode) throw Object.assign(new Error(`push service answered ${statusCode}`), { statusCode });
      sent.push({ subscription: target, payload: JSON.parse(payload), options });
    },
  });
  return sent;
}

test('the VAPID key pair is minted once and then read back from app_config', async () => {
  await withIsolatedDatabase(async () => {
    const first = getVapidKeys();
    assert.ok(first.publicKey.length > 40 && first.privateKey.length > 20);
    assert.deepEqual(getVapidKeys(), first);
    assert.equal(JSON.parse(appConfigDb.get('webPush.vapid.v1') ?? '{}').publicKey, first.publicKey);
  });
});

test('parseWebPushSubscription only admits https endpoints with both keys', () => {
  assert.deepEqual(parseWebPushSubscription({ endpoint: 'https://push.example/abc', keys: { p256dh: 'a', auth: 'b' } }), {
    endpoint: 'https://push.example/abc', keys: { p256dh: 'a', auth: 'b' }, expirationTime: null,
  });
  for (const invalid of [
    null,
    'https://push.example/abc',
    { endpoint: 'http://push.example/abc', keys: { p256dh: 'a', auth: 'b' } },
    { endpoint: 'https://push.example/abc', keys: { p256dh: 'a' } },
    { endpoint: 'https://push.example/abc', keys: { p256dh: '', auth: 'b' } },
  ]) {
    assert.equal(parseWebPushSubscription(invalid), null);
  }
});

test('a run-stopped event reaches every enabled subscription with the app session id and VAPID details', async () => {
  await withIsolatedDatabase(async () => {
    const userId = Number(userDb.createUser('push-user', 'hash').id);
    notificationPreferencesDb.updatePreferences(userId, {
      channels: { webPush: true },
      events: { actionRequired: true, stop: true, error: true },
    });
    subscribe(userId, 'https://push.example/phone');
    subscribe(userId, 'https://push.example/laptop');
    const disabled = subscribe(userId, 'https://push.example/muted');
    notificationChannelEndpointsDb.setEndpointEnabled(userId, CHANNEL_WEB_PUSH, disabled.endpoint_id, false);
    sessionsDb.createAppSession('app-session-1', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-session-1', 'claude', 'claude-native-1');
    const sent = fakeTransport();

    await notifyRunStopped({ userId, provider: 'claude', sessionId: 'claude-native-1', stopReason: 'completed' });

    assert.deepEqual(sent.map((entry) => entry.subscription.endpoint).sort(), ['https://push.example/laptop', 'https://push.example/phone']);
    const payload = sent[0]?.payload as { data?: { sessionId?: string; tag?: string } };
    assert.equal(payload.data?.sessionId, 'app-session-1');
    assert.match(payload.data?.tag ?? '', /app-session-1/);
    assert.equal(sent[0]?.options.urgency, 'high');
    assert.equal(sent[0]?.options.vapidDetails.publicKey, getVapidKeys().publicKey);
    assert.match(sent[0]?.options.vapidDetails.subject ?? '', /^https:\/\//);
  });
});

test('a subscription the push service reports gone is dropped; other failures keep it', async () => {
  await withIsolatedDatabase(async () => {
    const userId = Number(userDb.createUser('push-user', 'hash').id);
    subscribe(userId, 'https://push.example/gone');
    subscribe(userId, 'https://push.example/flaky');
    subscribe(userId, 'https://push.example/ok');
    const sent = fakeTransport(new Map([['https://push.example/gone', 410], ['https://push.example/flaky', 503]]));

    const result = await sendWebPushNotification(userId, { title: 't', body: 'b', data: {} });

    assert.deepEqual(result, { delivered: 1, removed: 1, failed: 1 });
    assert.equal(sent.length, 1);
    assert.deepEqual(
      notificationChannelEndpointsDb.getEndpoints(userId, CHANNEL_WEB_PUSH).map((row) => row.endpoint_id).sort(),
      ['https://push.example/flaky', 'https://push.example/ok'],
    );
  });
});

test('nothing is sent when the channel preference is off, even with subscriptions stored', async () => {
  await withIsolatedDatabase(async () => {
    const userId = Number(userDb.createUser('push-user', 'hash').id);
    notificationPreferencesDb.updatePreferences(userId, {
      channels: { webPush: false },
      events: { actionRequired: true, stop: true, error: true },
    });
    subscribe(userId, 'https://push.example/phone');
    const sent = fakeTransport();

    await notifyRunStopped({ userId, provider: 'claude', sessionId: 'none-1', stopReason: 'completed' });

    assert.equal(sent.length, 0);
  });
});
