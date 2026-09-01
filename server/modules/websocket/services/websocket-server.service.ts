import type { Server as HttpServer } from 'node:http';

import { WebSocketServer, type VerifyClientCallbackSync } from 'ws';

import { handleDesktopNotificationsConnection } from '@/modules/notifications/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';
import { verifyWebSocketClient } from '@/modules/websocket/services/websocket-auth.service.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

type WebSocketServerDependencies = {
  verifyClient: Parameters<typeof verifyWebSocketClient>[1];
  chat: Parameters<typeof handleChatConnection>[2];
  shell: Parameters<typeof handleShellConnection>[1];
  browser?: (ws: Parameters<typeof handleChatConnection>[0], request: AuthenticatedWebSocketRequest) => void;
};

function startHeartbeat(socket: Parameters<typeof handleChatConnection>[0]): void {
  const timer = setInterval(() => {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.ping();
    } catch {
      // Closing a socket can race with the periodic probe.
    }
  }, 30_000);

  const cancel = () => clearInterval(timer);
  socket.on('close', cancel);
  socket.on('error', cancel);
}

function connectionPath(request: AuthenticatedWebSocketRequest): string {
  return new URL(request.url ?? '/', 'http://localhost').pathname;
}

export function createWebSocketServer(
  server: HttpServer,
  dependencies: WebSocketServerDependencies
): WebSocketServer {
  const gateway = new WebSocketServer({
    server,
    verifyClient: (
      request: Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0]
    ) => verifyWebSocketClient(request, dependencies.verifyClient),
  });

  gateway.on('connection', (socket, rawRequest) => {
    startHeartbeat(socket);
    const request = rawRequest as AuthenticatedWebSocketRequest;
    const pathname = connectionPath(request);

    switch (pathname) {
      case '/shell':
        handleShellConnection(socket, dependencies.shell);
        return;
      case '/ws':
        handleChatConnection(socket, request, dependencies.chat);
        return;
      case '/desktop-notifications':
        handleDesktopNotificationsConnection(socket, request);
        return;
      case '/ws/browser':
        if (dependencies.browser) {
          dependencies.browser(socket, request);
          return;
        }
        break;
      default:
        break;
    }

    console.log('[WARN] Unknown WebSocket path:', pathname);
    socket.close();
  });

  return gateway;
}
