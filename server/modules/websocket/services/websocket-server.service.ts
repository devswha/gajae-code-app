import type { Server as HttpServer } from 'node:http';

import { WebSocketServer, type VerifyClientCallbackSync } from 'ws';

import { handleDesktopNotificationsConnection } from '@/modules/notifications/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';
import { verifyWebSocketClient } from '@/modules/websocket/services/websocket-auth.service.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

type UpgradeVerifier = Parameters<typeof verifyWebSocketClient>[1];
type GatewayDependencies = {
  verifyClient: UpgradeVerifier;
  chat: Parameters<typeof handleChatConnection>[2]; shell: Parameters<typeof handleShellConnection>[1];
  browser?: (ws: Parameters<typeof handleChatConnection>[0], request: AuthenticatedWebSocketRequest) => void;
};

function startHeartbeat(socket: Parameters<typeof handleChatConnection>[0]): void {
  const heartbeat = setInterval(() => {
    if (socket.readyState !== socket.OPEN) return;
    // Closing a socket can race with the periodic probe.
    try { socket.ping(); } catch { /* raced with close */ }
  }, 30_000);

  const stopHeartbeat = () => clearInterval(heartbeat);
  socket.on('close', stopHeartbeat);
  socket.on('error', stopHeartbeat);
}

function connectionPath(request: AuthenticatedWebSocketRequest): string {
  return new URL(request.url ?? '/', 'http://localhost').pathname;
}

export function createWebSocketServer(server: HttpServer, dependencies: GatewayDependencies): WebSocketServer {
  const verification = {
    verifyClient: (info: Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0]) => verifyWebSocketClient(info, dependencies.verifyClient),
  };
  const gateway = new WebSocketServer({ ...verification, server });

  gateway.on('connection', (socket, rawRequest) => {
    startHeartbeat(socket);
    const request = rawRequest as AuthenticatedWebSocketRequest;
    const pathname = connectionPath(request);
    const routeHandlers: Record<string, () => boolean> = {
      '/shell': () => {
        handleShellConnection(socket, dependencies.shell);
        return true;
      },
      '/ws': () => {
        handleChatConnection(socket, request, dependencies.chat);
        return true;
      },
      '/desktop-notifications': () => {
        handleDesktopNotificationsConnection(socket, request);
        return true;
      },
      '/ws/browser': () => {
        if (!dependencies.browser) return false;
        dependencies.browser(socket, request);
        return true;
      },
    };
    if (routeHandlers[pathname]?.()) return;

    console.log('[WARN] Unknown WebSocket path:', pathname);
    socket.close();
  });
  return gateway;
}
