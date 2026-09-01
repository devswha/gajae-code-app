import type { WebSocket } from 'ws';

import { notificationChannelEndpointsDb } from '@/modules/database/index.js';

// The channel value is part of the endpoint rows in the database; only the
// constant's name is ours to choose.
const CHANNEL_DESKTOP = 'desktop';

type ClientRegistration = { endpointId: string; userId: number };
type DesktopClientRegistration = {
  ws: WebSocket; userId: number; deviceId: string;
  label?: string | null; platform?: string | null; appVersion?: string | null;
};

const registrationForSocket = new WeakMap<WebSocket, ClientRegistration>();
const clientsByUser = new Map<number, Map<string, WebSocket>>();

function userIdOrNull(value: unknown): number | null {
  const userId = Number(value);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function endpointIdFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clientsFor(userId: number): Map<string, WebSocket> {
  const existing = clientsByUser.get(userId);
  if (existing) return existing;

  const created = new Map<string, WebSocket>();
  clientsByUser.set(userId, created);
  return created;
}

function forgetClient(ws: WebSocket): void {
  const registration = registrationForSocket.get(ws);
  if (!registration) return;

  const userClients = clientsByUser.get(registration.userId);
  if (userClients?.get(registration.endpointId) === ws) {
    userClients.delete(registration.endpointId);
    if (userClients.size === 0) clientsByUser.delete(registration.userId);
  }
  registrationForSocket.delete(ws);
}

function serializeNotification(payload: unknown): string {
  const tag = (payload as { data?: { tag?: unknown } } | null)?.data?.tag;
  return JSON.stringify({
    type: 'notification',
    id: typeof tag === 'string' ? tag : `${Date.now()}`,
    payload,
  });
}

export function registerDesktopNotificationClient(registration: DesktopClientRegistration) {
  const { ws, userId, deviceId, label = null, platform = null, appVersion = null } = registration;
  const ownerId = userIdOrNull(userId);
  const endpointId = endpointIdFrom(deviceId);
  if (ownerId === null || !endpointId) return false;

  const upsertRecord = {
    userId: ownerId, channel: CHANNEL_DESKTOP, endpointId, label,
    metadata: { platform, appVersion }, enabled: true,
  };
  const endpoint = notificationChannelEndpointsDb.upsertEndpoint(upsertRecord);

  const userClients = clientsFor(ownerId);
  const replacedSocket = userClients.get(endpointId);
  if (replacedSocket && replacedSocket !== ws && replacedSocket.readyState === replacedSocket.OPEN) {
    replacedSocket.close(4000, 'Device reconnected');
  }

  userClients.set(endpointId, ws);
  registrationForSocket.set(ws, { userId: ownerId, endpointId });
  return endpoint;
}

export function unregisterDesktopNotificationClient(ws: WebSocket): void { forgetClient(ws); }

export function sendDesktopNotification(userId: unknown, payload: unknown): { attempted: number; sent: number } {
  const ownerId = userIdOrNull(userId);
  const userClients = ownerId === null ? undefined : clientsByUser.get(ownerId);
  if (ownerId === null || !userClients?.size) return { attempted: 0, sent: 0 };

  const enabledEndpoints = new Set(
    notificationChannelEndpointsDb.getEnabledEndpoints(ownerId, CHANNEL_DESKTOP).map(({ endpoint_id }) => endpoint_id),
  );
  const message = serializeNotification(payload);
  const tally = { attempted: 0, sent: 0 };

  for (const [endpointId, socket] of userClients) {
    if (!enabledEndpoints.has(endpointId)) continue;
    tally.attempted += 1;
    if (socket.readyState !== socket.OPEN) { forgetClient(socket); continue; }

    try {
      socket.send(message);
      notificationChannelEndpointsDb.touchEndpoint(ownerId, CHANNEL_DESKTOP, endpointId);
      tally.sent += 1;
    } catch { forgetClient(socket); }
  }
  return tally;
}
