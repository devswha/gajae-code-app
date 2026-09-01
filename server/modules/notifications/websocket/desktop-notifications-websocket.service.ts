import type { WebSocket } from 'ws';

import { registerDesktopNotificationClient, unregisterDesktopNotificationClient } from '@/modules/notifications/services/desktop-notification-clients.service.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';
import { parseIncomingJsonObject } from '@/shared/utils.js';

type DesktopNotificationRegisterMessage = { appVersion?: unknown; deviceId?: unknown; kind?: unknown; label?: unknown; platform?: unknown; type?: unknown };

function nonEmptyText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized === '' ? null : normalized;
}

function requestUserId(request: AuthenticatedWebSocketRequest): number | null {
  const account = request.user;
  let rawId: unknown = null;
  if (typeof account?.id === 'string' || typeof account?.id === 'number') rawId = account.id;
  else if (typeof account?.userId === 'string' || typeof account?.userId === 'number') rawId = account.userId;
  if (rawId === null) return null;
  const numericId = Number(rawId);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

function sendWhenOpen(ws: WebSocket, message: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function registerCommand(message: DesktopNotificationRegisterMessage): string {
  return typeof message.type === 'string'
    ? message.type
    : typeof message.kind === 'string' ? message.kind : '';
}

export function handleDesktopNotificationsConnection(ws: WebSocket, request: AuthenticatedWebSocketRequest): void {
  const userId = requestUserId(request);
  if (userId === null) return ws.close(1008, 'Missing authenticated user');

  let boundToClient = false;
  ws.on('message', (incoming) => {
    const message = parseIncomingJsonObject(incoming) as DesktopNotificationRegisterMessage | null;
    if (!message) return;

    const command = registerCommand(message);
    if (boundToClient || command === 'notification_ack' || command !== 'register') return;

    const deviceId = nonEmptyText(message.deviceId);
    if (deviceId === null) {
      const rejection = { type: 'error', code: 'DEVICE_ID_REQUIRED', message: 'Desktop notification registration requires deviceId.' };
      sendWhenOpen(ws, rejection);
      return ws.close(1008, 'Missing deviceId');
    }

    const registration = {
      userId, deviceId, ws,
      label: nonEmptyText(message.label),
      platform: nonEmptyText(message.platform),
      appVersion: nonEmptyText(message.appVersion),
    };
    const endpoint = registerDesktopNotificationClient(registration);
    if (!endpoint) return ws.close(1011, 'Registration failed');

    boundToClient = true;
    const confirmation = { type: 'registered', deviceId: endpoint.endpoint_id, enabled: Boolean(endpoint.enabled) };
    sendWhenOpen(ws, confirmation);
  });

  const unregister = (): void => unregisterDesktopNotificationClient(ws);
  ws.on('close', unregister);
  ws.on('error', unregister);
}
