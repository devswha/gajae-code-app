import type { VerifyClientCallbackSync } from 'ws';

import { isAllowedRequestOrigin } from '@/shared/request-origin.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

import { parseAllowedHosts } from '../../../../shared/networkHosts.js';

type WebSocketAuthDependencies = Readonly<{
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
}>;

function acceptsOrigin(request: AuthenticatedWebSocketRequest, allowedHosts?: string): boolean {
  return isAllowedRequestOrigin(request.headers.origin, {
    hostHeader: request.headers.host,
    allowedHosts: parseAllowedHosts(allowedHosts ?? process.env.ALLOWED_HOSTS),
  });
}

export function verifyWebSocketClient(
  info: Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0],
  dependencies: WebSocketAuthDependencies
): boolean {
  const request = info.req as AuthenticatedWebSocketRequest;
  console.log('WebSocket connection attempt to:', new URL(request.url ?? '/', 'http://localhost').pathname);

  if (!acceptsOrigin(request, dependencies.allowedHosts)) {
    console.log('[WARN] WebSocket upgrade rejected for origin:', request.headers.origin);
    return false;
  }

  const desktopAuth = dependencies.desktopAuth;
  if (desktopAuth && !desktopAuth.authenticateWebSocket(request)) {
    return false;
  }

  const owner = dependencies.authenticateWebSocket();
  if (!owner) {
    console.log('[WARN] WebSocket authentication failed');
    return false;
  }

  request.user = owner;
  console.log('[OK] WebSocket authenticated for user:', owner.username);
  return true;
}
