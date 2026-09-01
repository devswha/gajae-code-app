import type { VerifyClientCallbackSync } from 'ws';

import { isAllowedRequestOrigin } from '@/shared/request-origin.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

import { parseAllowedHosts } from '../../../../shared/networkHosts.js';

type AuthenticatedOwner = Record<string, unknown> & {
  id?: number | string;
  userId?: number | string;
  username?: string;
};

type WebSocketAuthDependencies = Readonly<{
  authenticateWebSocket: () => AuthenticatedOwner | null;
  desktopAuth?: { authenticateWebSocket: (request: { headers: { origin?: string; cookie?: string } }) => boolean };
  /** Raw `ALLOWED_HOSTS`; defaults to the process environment. */
  allowedHosts?: string | undefined;
}>;

function acceptsOrigin(request: AuthenticatedWebSocketRequest, configuredHosts?: string): boolean {
  const allowedHosts = parseAllowedHosts(configuredHosts ?? process.env.ALLOWED_HOSTS);
  return isAllowedRequestOrigin(request.headers.origin, {
    hostHeader: request.headers.host,
    allowedHosts,
  });
}

function requestPath(request: AuthenticatedWebSocketRequest): string {
  return new URL(request.url ?? '/', 'http://localhost').pathname;
}

export function verifyWebSocketClient(info: Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0], dependencies: WebSocketAuthDependencies): boolean {
  const upgradeRequest = info.req as AuthenticatedWebSocketRequest;
  console.log('WebSocket connection attempt to:', requestPath(upgradeRequest));

  if (!acceptsOrigin(upgradeRequest, dependencies.allowedHosts)) {
    console.log('[WARN] WebSocket upgrade rejected for origin:', upgradeRequest.headers.origin);
    return false;
  }

  // Desktop credentials are checked before the owner is attached to an upgrade request.
  if (dependencies.desktopAuth && !dependencies.desktopAuth.authenticateWebSocket(upgradeRequest)) return false;

  const owner = dependencies.authenticateWebSocket();
  if (!owner) {
    console.log('[WARN] Rejected WebSocket upgrade: no authenticated user');
    return false;
  }

  upgradeRequest.user = owner;
  console.log('[OK] WebSocket authenticated for user:', owner.username);
  return true;
}
