import type { WebSocket } from 'ws';

import { notificationChannelEndpointsDb } from '@/modules/database/index.js';

const DESKTOP_CHANNEL = 'desktop';

type ClientRegistration = { endpointId: string; userId: number };

const registrations = new WeakMap<WebSocket, ClientRegistration>();
const socketsForUser = new Map<number, Map<string, WebSocket>>();

const validUserId = (value: unknown): number | null => {
  const candidate = Number(value);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : null;
};

const deviceKey = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

function registrationMap(userId: number): Map<string, WebSocket> {
  let entries = socketsForUser.get(userId);
  if (!entries) {
    entries = new Map();
    socketsForUser.set(userId, entries);
  }
  return entries;
}

function removeSocket(ws: WebSocket): void {
  const registration = registrations.get(ws);
  if (!registration) return;

  const entries = socketsForUser.get(registration.userId);
  if (entries?.get(registration.endpointId) === ws) {
    entries.delete(registration.endpointId);
    if (entries.size === 0) socketsForUser.delete(registration.userId);
  }
  registrations.delete(ws);
}

function notificationMessage(payload: unknown): string {
  const tag = (payload as { data?: { tag?: unknown } } | null)?.data?.tag;
  return JSON.stringify({
    type: 'notification',
    id: typeof tag === 'string' ? tag : `${Date.now()}`,
    payload,
  });
}

export function registerDesktopNotificationClient({
  ws, userId, deviceId, label = null, platform = null, appVersion = null,
}: {
  ws: WebSocket; userId: number; deviceId: string;
  label?: string | null; platform?: string | null; appVersion?: string | null;
}) {
  const owner = validUserId(userId);
  const endpointId = deviceKey(deviceId);
  if (!owner || !endpointId) return false;

  const endpoint = notificationChannelEndpointsDb.upsertEndpoint({
    userId: owner,
    channel: DESKTOP_CHANNEL,
    endpointId,
    label,
    metadata: { platform, appVersion },
    enabled: true,
  });

  const clients = registrationMap(owner);
  const previous = clients.get(endpointId);
  if (previous && previous !== ws && previous.readyState === previous.OPEN) {
    previous.close(4000, 'Device reconnected');
  }

  clients.set(endpointId, ws);
  registrations.set(ws, { userId: owner, endpointId });
  return endpoint;
}

export function unregisterDesktopNotificationClient(ws: WebSocket): void {
  removeSocket(ws);
}

export function sendDesktopNotification(userId: unknown, payload: unknown): { attempted: number; sent: number } {
  const owner = validUserId(userId);
  const clients = owner === null ? undefined : socketsForUser.get(owner);
  if (!owner || !clients?.size) return { attempted: 0, sent: 0 };

  const deliverable = new Set(
    notificationChannelEndpointsDb.getEnabledEndpoints(owner, DESKTOP_CHANNEL).map(({ endpoint_id }) => endpoint_id),
  );
  const message = notificationMessage(payload);
  let attempted = 0;
  let sent = 0;

  for (const [endpointId, socket] of clients) {
    if (!deliverable.has(endpointId)) continue;
    attempted += 1;
    if (socket.readyState !== socket.OPEN) {
      removeSocket(socket);
      continue;
    }
    try {
      socket.send(message);
      notificationChannelEndpointsDb.touchEndpoint(owner, DESKTOP_CHANNEL, endpointId);
      sent += 1;
    } catch {
      removeSocket(socket);
    }
  }
  return { attempted, sent };
}
