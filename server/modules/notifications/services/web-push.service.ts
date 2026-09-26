import webpush from 'web-push';

import { appConfigDb, notificationChannelEndpointsDb } from '@/modules/database/index.js';

import { ISSUES_URL } from '../../../../shared/productIdentity.js';

// The channel value is part of the endpoint rows in the database; only the
// constant's name is ours to choose.
export const CHANNEL_WEB_PUSH = 'webPush';
const VAPID_CONFIG_KEY = 'webPush.vapid.v1';
const NOTIFICATION_TTL_SECONDS = 600;
// A push service answers 404/410 for a subscription its browser has revoked.
const GONE_STATUS_CODES = new Set([404, 410]);

export type WebPushSubscription = { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime?: number | null };
type VapidKeys = { publicKey: string; privateKey: string };
type SendResult = { delivered: number; removed: number; failed: number };
type SendError = Error & { statusCode?: number };
export type WebPushTransport = {
  sendNotification: (subscription: WebPushSubscription, payload: string, options: { TTL: number; urgency: 'high'; vapidDetails: VapidKeys & { subject: string } }) => Promise<unknown>;
};

let transport: WebPushTransport = webpush;

/** Tests substitute the push service; production always talks to the real one. */
export function configureWebPushTransport(next: WebPushTransport | null): void {
  transport = next ?? webpush;
}

function parseVapidKeys(serialized: string | null): VapidKeys | null {
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(serialized) as Partial<VapidKeys>;
    return typeof parsed.publicKey === 'string' && typeof parsed.privateKey === 'string' && parsed.publicKey && parsed.privateKey
      ? { publicKey: parsed.publicKey, privateKey: parsed.privateKey }
      : null;
  } catch {
    return null;
  }
}

/**
 * One VAPID key pair per server, minted on first use and kept in app_config.
 * Rotating it invalidates every stored subscription, so it is never regenerated
 * on the server's own initiative.
 */
export function getVapidKeys(): VapidKeys {
  const stored = parseVapidKeys(appConfigDb.get(VAPID_CONFIG_KEY));
  if (stored) return stored;
  const generated = webpush.generateVAPIDKeys();
  appConfigDb.set(VAPID_CONFIG_KEY, JSON.stringify(generated));
  return generated;
}

export function getVapidPublicKey(): string {
  return getVapidKeys().publicKey;
}

function subscriptionFromMetadata(endpoint: string, metadata: Record<string, unknown> | null): WebPushSubscription | null {
  const keys = metadata?.keys as Partial<WebPushSubscription['keys']> | undefined;
  if (typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function parseWebPushSubscription(value: unknown): WebPushSubscription | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; expirationTime?: unknown };
  if (typeof candidate.endpoint !== 'string' || !/^https:\/\//.test(candidate.endpoint)) return null;
  if (typeof candidate.keys?.p256dh !== 'string' || typeof candidate.keys?.auth !== 'string') return null;
  if (!candidate.keys.p256dh || !candidate.keys.auth) return null;
  return {
    endpoint: candidate.endpoint,
    keys: { p256dh: candidate.keys.p256dh, auth: candidate.keys.auth },
    expirationTime: typeof candidate.expirationTime === 'number' ? candidate.expirationTime : null,
  };
}

/**
 * Delivers one payload to every enabled web-push endpoint of the user. A
 * subscription the push service reports gone is removed; other failures are
 * counted and logged, never thrown, so one dead phone cannot block the rest.
 */
export async function sendWebPushNotification(userId: number, payload: unknown): Promise<SendResult> {
  const endpoints = notificationChannelEndpointsDb.getEnabledEndpoints(userId, CHANNEL_WEB_PUSH);
  if (endpoints.length === 0) return { delivered: 0, removed: 0, failed: 0 };

  const keys = getVapidKeys();
  const body = JSON.stringify(payload);
  const result: SendResult = { delivered: 0, removed: 0, failed: 0 };
  await Promise.all(endpoints.map(async (endpoint) => {
    const subscription = subscriptionFromMetadata(endpoint.endpoint_id, notificationChannelEndpointsDb.parseMetadata(endpoint.metadata_json));
    if (!subscription) {
      notificationChannelEndpointsDb.removeEndpoint(userId, CHANNEL_WEB_PUSH, endpoint.endpoint_id);
      result.removed += 1;
      return;
    }
    try {
      await transport.sendNotification(subscription, body, {
        TTL: NOTIFICATION_TTL_SECONDS,
        urgency: 'high',
        vapidDetails: { subject: ISSUES_URL, ...keys },
      });
      notificationChannelEndpointsDb.touchEndpoint(userId, CHANNEL_WEB_PUSH, endpoint.endpoint_id);
      result.delivered += 1;
    } catch (error) {
      const statusCode = (error as SendError)?.statusCode;
      if (statusCode !== undefined && GONE_STATUS_CODES.has(statusCode)) {
        notificationChannelEndpointsDb.removeEndpoint(userId, CHANNEL_WEB_PUSH, endpoint.endpoint_id);
        result.removed += 1;
        return;
      }
      result.failed += 1;
      console.error('Notification channel "webPush" send error:', statusCode ?? '', (error as Error)?.message ?? error);
    }
  }));
  return result;
}
