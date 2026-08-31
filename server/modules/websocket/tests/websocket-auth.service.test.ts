import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyWebSocketClient } from '@/modules/websocket/services/websocket-auth.service.js';

/*
 * The upgrade check is the only thing standing between a page the owner
 * happens to visit and a fully authorized socket onto a server that runs shell
 * commands. A WebSocket handshake is not subject to the same-origin policy, and
 * the owner here is implicit - `authenticateWebSocket` takes no argument and
 * always returns them - so "can reach the port" used to be the whole of
 * "authorized". Loopback binding is no defence: the hostile page runs inside
 * the owner's own browser, which can reach loopback.
 */

const owner = () => ({ userId: 'owner', username: 'owner' });

const upgrade = (headers: Record<string, string | undefined>) => ({
  req: { url: '/ws', headers },
  origin: headers.origin ?? '',
  secure: false,
}) as never;

const verify = (
  headers: Record<string, string | undefined>,
  allowedHosts?: string,
) => verifyWebSocketClient(upgrade({ host: '127.0.0.1:3001', ...headers }), {
  authenticateWebSocket: owner,
  allowedHosts,
});

test('a hostile site cannot open a socket onto a loopback server', () => {
  assert.equal(verify({ origin: 'https://evil.example' }), false);
});

test('the opaque origin cannot open a socket', () => {
  // Sandboxed iframes and file:// documents send this.
  assert.equal(verify({ origin: 'null' }), false);
});

test('a hostname that merely looks like loopback is still foreign', () => {
  assert.equal(verify({ origin: 'https://127.0.0.1.evil.example' }), false);
  assert.equal(verify({ origin: 'https://localhost.evil.example' }), false);
});

test('the dev client on another port still connects', () => {
  // Vite serves the UI on 5173 and proxies the socket to 3001, forwarding the
  // original Origin, so a port comparison would break every dev session.
  assert.equal(verify({ origin: 'http://localhost:5173' }), true);
  assert.equal(verify({ origin: 'http://127.0.0.1:5173' }), true);
});

test('a native client that sends no Origin still connects', () => {
  // The Tauri shell and CLI callers omit it. A browser cannot omit it
  // cross-origin, so this costs nothing.
  assert.equal(verify({}), true);
});

test('a host the owner listed in ALLOWED_HOSTS connects', () => {
  assert.equal(verify({ origin: 'https://mac.tail1e211e.ts.net' }, '.tail1e211e.ts.net'), true);
  assert.equal(verify({ origin: 'https://evil.example' }, '.tail1e211e.ts.net'), false);
});

test('the origin check runs before the desktop credential check', () => {
  // Otherwise a rejected origin would still exercise the credential path, and
  // in non-desktop mode that path returns true unconditionally.
  let desktopConsulted = false;

  const allowed = verifyWebSocketClient(upgrade({ host: '127.0.0.1:3001', origin: 'https://evil.example' }), {
    authenticateWebSocket: owner,
    desktopAuth: {
      authenticateWebSocket: () => { desktopConsulted = true; return true; },
    },
  });

  assert.equal(allowed, false);
  assert.equal(desktopConsulted, false);
});

test('a rejected origin never reaches the implicit owner lookup', () => {
  let ownerLookedUp = false;

  const allowed = verifyWebSocketClient(upgrade({ host: '127.0.0.1:3001', origin: 'https://evil.example' }), {
    authenticateWebSocket: () => { ownerLookedUp = true; return owner(); },
  });

  assert.equal(allowed, false);
  assert.equal(ownerLookedUp, false);
});
