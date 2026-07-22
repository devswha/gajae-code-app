import type { VerifyClientCallbackSync } from 'ws';

import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

type WebSocketAuthDependencies = {
  authenticateWebSocket: () => {
    id?: string | number;
    userId?: string | number;
    username?: string;
    [key: string]: unknown;
  } | null;
  desktopAuth?: {
    authenticateWebSocket: (request: { headers: { origin?: string; cookie?: string } }) => boolean;
  };
};


/**
 * Authenticates websocket upgrade requests before the `connection` handler runs.
 */
export function verifyWebSocketClient(
  info: Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0],
  dependencies: WebSocketAuthDependencies
): boolean {
  const request = info.req as AuthenticatedWebSocketRequest;
  const upgradeUrl = new URL(request.url ?? '/', 'http://localhost');
  console.log('WebSocket connection attempt to:', upgradeUrl.pathname);


  if (dependencies.desktopAuth && !dependencies.desktopAuth.authenticateWebSocket(request)) {
    return false;
  }
  const user = dependencies.authenticateWebSocket();
  if (!user) {
    console.log('[WARN] WebSocket authentication failed');
    return false;
  }

  request.user = user;
  console.log('[OK] WebSocket authenticated for user:', user.username);
  return true;
}
