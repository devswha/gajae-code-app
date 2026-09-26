import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../utils/api';

import { useDeviceSettings } from './useDeviceSettings';

export const SERVICE_WORKER_URL = '/sw.js';

export type WebPushState = {
  /** The browser can subscribe here right now. */
  supported: boolean;
  /** Service workers exist only on https (or localhost); a plain-http LAN/tailnet address cannot push. */
  requiresSecureContext: boolean;
  /** iOS Safari only pushes to a home-screen install; the tab must be reopened from there. */
  requiresHomeScreenInstall: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  busy: boolean;
  error: string | null;
};

const iOS = () => typeof navigator !== 'undefined'
  && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const pushSupported = () => typeof window !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** The VAPID key travels base64url; PushManager wants the raw 65 bytes. */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(SERVICE_WORKER_URL);
  return navigator.serviceWorker.ready;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const existing = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  return existing ? existing.pushManager.getSubscription() : null;
}

function deviceLabel(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const platform = agent.match(/\((.*?)\)/)?.[1]?.split(';')[0]?.trim();
  return platform ? platform.slice(0, 80) : 'Browser';
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/**
 * Subscribes this browser (or home-screen install) to the server's web push
 * channel. The server keeps one row per subscription endpoint and flips the
 * `webPush` channel preference as rows come and go; `onChannelChange` lets the
 * settings form mirror that flip so its autosave does not undo it.
 */
export function useWebPush(onChannelChange?: (enabled: boolean) => void) {
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const supported = pushSupported();
  const [permission, setPermission] = useState<WebPushState['permission']>(() => (supported ? Notification.permission : 'unsupported'));
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return undefined;
    let live = true;
    currentSubscription().then((subscription) => {
      if (live) setSubscribed(Boolean(subscription));
    }).catch(() => {
      // An unreadable registration reads as "not subscribed"; subscribing repairs it.
    });
    return () => { live = false; };
  }, [supported]);

  const subscribe = useCallback(async () => {
    if (!supported || busy) return;
    setBusy(true);
    setError(null);
    try {
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') throw new Error('notifications-denied');
      const keyResponse = await authenticatedFetch('/api/notifications/web-push/public-key');
      if (!keyResponse.ok) throw new Error(`public key ${keyResponse.status}`);
      const { publicKey } = await keyResponse.json() as { publicKey: string };
      const worker = await registration();
      const subscription = await worker.pushManager.getSubscription()
        ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
      const stored = await authenticatedFetch('/api/notifications/web-push/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ subscription: subscription.toJSON(), label: deviceLabel() }),
      });
      if (!stored.ok) throw new Error(`subscribe ${stored.status}`);
      setSubscribed(true);
      onChannelChange?.(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }, [busy, onChannelChange, supported]);

  const unsubscribe = useCallback(async () => {
    if (!supported || busy) return;
    setBusy(true);
    setError(null);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        const removed = await authenticatedFetch('/api/notifications/web-push/subscriptions', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!removed.ok) throw new Error(`unsubscribe ${removed.status}`);
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      onChannelChange?.(false);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }, [busy, onChannelChange, supported]);

  const sendTest = useCallback(async () => {
    setError(null);
    try {
      const response = await authenticatedFetch('/api/notifications/web-push/test', { method: 'POST' });
      if (!response.ok) throw new Error(`test ${response.status}`);
      const result = await response.json() as { delivered: number; removed: number; failed: number };
      if (result.delivered > 0) return;
      // The push service revoked every stored subscription; a fresh subscribe re-registers this one.
      if (result.removed > 0) setSubscribed(false);
      throw new Error(result.removed > 0 ? 'subscription-gone' : 'no-delivery');
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, []);

  const secure = typeof window !== 'undefined' && window.isSecureContext;
  const state: WebPushState = {
    supported,
    requiresSecureContext: !supported && !secure,
    requiresHomeScreenInstall: !supported && secure && iOS() && !isPWA,
    permission,
    subscribed,
    busy,
    error,
  };
  return { ...state, subscribe, unsubscribe, sendTest };
}
