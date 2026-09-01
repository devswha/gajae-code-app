import type { WebSocket } from 'ws';

import { registerDesktopNotificationClient, unregisterDesktopNotificationClient } from '@/modules/notifications/services/desktop-notification-clients.service.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';
import { parseIncomingJsonObject } from '@/shared/utils.js';

type DesktopNotificationRegisterMessage = { appVersion?: unknown; deviceId?: unknown; kind?: unknown; label?: unknown; platform?: unknown; type?: unknown };

const nullableText = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
};

function authenticatedUserId(request: AuthenticatedWebSocketRequest): number | null {
  const identity = request.user;
  const source = typeof identity?.id === 'string' || typeof identity?.id === 'number'
    ? identity.id
    : typeof identity?.userId === 'string' || typeof identity?.userId === 'number'
      ? identity.userId
      : null;
  const id = (typeof source === 'string' || typeof source === 'number') ? Number(source) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

function send(ws: WebSocket, value: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(value));
}

export function handleDesktopNotificationsConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest
): void {
  const userId = authenticatedUserId(request);
  if (!userId) {
    ws.close(1008, 'Missing authenticated user');
    return;
  }

  let hasRegistered = false;

  ws.on('message', (rawMessage) => {
    const message = parseIncomingJsonObject(rawMessage) as DesktopNotificationRegisterMessage | null;
    if (!message) return;

    const command = typeof message.type === 'string'
      ? message.type
      : typeof message.kind === 'string' ? message.kind : '';
    if (command === 'notification_ack' || command !== 'register' || hasRegistered) return;

    const deviceId = nullableText(message.deviceId);
    if (!deviceId) {
      send(ws, {
        type: 'error',
        code: 'DEVICE_ID_REQUIRED',
        message: 'Desktop notification registration requires deviceId.',
      });
      ws.close(1008, 'Missing deviceId');
      return;
    }

    const device = registerDesktopNotificationClient({
      userId,
      deviceId,
      label: nullableText(message.label),
      platform: nullableText(message.platform),
      appVersion: nullableText(message.appVersion),
      ws,
    });

    if (!device) {
      ws.close(1011, 'Registration failed');
      return;
    }

    hasRegistered = true;
    send(ws, {
      type: 'registered',
      deviceId: device.endpoint_id,
      enabled: Boolean(device.enabled),
    });
  });

  const detach = () => unregisterDesktopNotificationClient(ws);
  ws.on('close', detach);
  ws.on('error', detach);
}
