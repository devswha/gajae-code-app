import type { VerifyClientCallbackSync } from 'ws';

import { isAllowedRequestOrigin } from '@/shared/request-origin.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

import { parseAllowedHosts } from '../../../../shared/networkHosts.js';

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
  /** Raw `ALLOWED_HOSTS`; defaults to the process environment. */
  allowedHosts?: string | undefined;
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

  // A WebSocket handshake is not subject to the same-origin policy, and the
  // owner below is implicit - so without this, any page the owner visits gets a
  // fully authorized socket onto a server that runs shell commands. Loopback
  // binding does not help: the hostile page runs in the owner's own browser.
  const origin = request.headers.origin;
  if (!isAllowedRequestOrigin(origin, {
    hostHeader: request.headers.host,
    allowedHosts: parseAllowedHosts(dependencies.allowedHosts ?? process.env.ALLOWED_HOSTS),
  })) {
    console.log('[WARN] WebSocket upgrade rejected for origin:', origin);
    return false;
  }

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
