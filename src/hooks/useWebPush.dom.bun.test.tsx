import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { useWebPush } from './useWebPush';

type Call = { url: string; method: string; body: unknown };

const PUBLIC_KEY = 'BCoYPt8jlhMjt1E_hcSvmKcWYOGErYIKrvgAPiquGrVV7CaepgqXC9jo0HLbdwEdMATmYsVrZj1EeF6jqDBtFr0';
const originalFetch = globalThis.fetch;
const originalNotification = (globalThis as { Notification?: unknown }).Notification;
const originalPushManager = (globalThis as { PushManager?: unknown }).PushManager;
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

let calls: Call[];
let permissionAnswer: NotificationPermission;
let subscription: { endpoint: string; unsubscribed: number; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null;
let subscribeOptions: PushSubscriptionOptionsInit | null;

function fakeBrowser() {
  calls = [];
  permissionAnswer = 'granted';
  subscription = null;
  subscribeOptions = null;
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe: async (options: PushSubscriptionOptionsInit) => {
      subscribeOptions = options;
      subscription = {
        endpoint: 'https://push.example/phone',
        unsubscribed: 0,
        toJSON: () => ({ endpoint: 'https://push.example/phone', keys: { p256dh: 'p', auth: 'a' } }),
        async unsubscribe() { this.unsubscribed += 1; subscription = null; return true; },
      };
      return subscription;
    },
  };
  const registration = { pushManager };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: async () => registration,
      ready: Promise.resolve(registration),
      getRegistration: async () => registration,
    },
  });
  (globalThis as { PushManager?: unknown }).PushManager = function PushManager() {};
  (globalThis as { Notification?: unknown }).Notification = {
    permission: 'default',
    requestPermission: async () => permissionAnswer,
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (url.endsWith('/web-push/public-key')) return Response.json({ success: true, publicKey: PUBLIC_KEY });
    if (url.endsWith('/web-push/subscriptions')) return Response.json({ success: true });
    if (url.endsWith('/web-push/test')) return Response.json({ success: true, delivered: 0, removed: 1, failed: 0 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

beforeEach(fakeBrowser);
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  (globalThis as { Notification?: unknown }).Notification = originalNotification;
  (globalThis as { PushManager?: unknown }).PushManager = originalPushManager;
  if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  else delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

test('subscribing asks permission, subscribes with the server key, stores the subscription and reports the channel on', async () => {
  const channel: boolean[] = [];
  const { result } = renderHook(() => useWebPush((enabled) => channel.push(enabled)));
  assert.equal(result.current.supported, true);
  assert.equal(result.current.subscribed, false);

  await act(async () => { await result.current.subscribe(); });

  assert.equal(subscribeOptions?.userVisibleOnly, true);
  assert.equal((subscribeOptions?.applicationServerKey as Uint8Array).length, 65);
  const stored = calls.find((call) => call.method === 'POST' && call.url.endsWith('/web-push/subscriptions'));
  assert.deepEqual((stored?.body as { subscription: unknown }).subscription, { endpoint: 'https://push.example/phone', keys: { p256dh: 'p', auth: 'a' } });
  assert.equal(result.current.subscribed, true);
  assert.equal(result.current.error, null);
  assert.deepEqual(channel, [true]);
});

test('a refused permission leaves the browser unsubscribed and surfaces the reason', async () => {
  permissionAnswer = 'denied';
  const { result } = renderHook(() => useWebPush());

  await act(async () => { await result.current.subscribe(); });

  assert.equal(subscribeOptions, null);
  assert.equal(calls.length, 0);
  assert.equal(result.current.subscribed, false);
  assert.equal(result.current.permission, 'denied');
  assert.equal(result.current.error, 'notifications-denied');
});

test('unsubscribing removes the server row before dropping the browser subscription', async () => {
  const channel: boolean[] = [];
  const { result } = renderHook(() => useWebPush((enabled) => channel.push(enabled)));
  await act(async () => { await result.current.subscribe(); });
  const phone = subscription!;

  await act(async () => { await result.current.unsubscribe(); });

  const removed = calls.find((call) => call.method === 'DELETE');
  assert.deepEqual(removed?.body, { endpoint: 'https://push.example/phone' });
  assert.equal(phone.unsubscribed, 1);
  assert.equal(result.current.subscribed, false);
  assert.deepEqual(channel, [true, false]);
});

test('an existing browser subscription is reported on mount, and a test that finds it gone clears it', async () => {
  await act(async () => { await navigator.serviceWorker.ready.then((r) => r.pushManager.subscribe({ userVisibleOnly: true })); });
  const { result } = renderHook(() => useWebPush());
  await waitFor(() => assert.equal(result.current.subscribed, true));

  await act(async () => { await result.current.sendTest(); });

  assert.equal(result.current.subscribed, false);
  assert.equal(result.current.error, 'subscription-gone');
});
