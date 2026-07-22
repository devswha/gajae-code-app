import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyWebSocketClient } from '../modules/websocket/services/websocket-auth.service.js';

test('WebSocket authentication runs the desktop-key gate before attaching the implicit owner', () => {
  let authenticated = false;
  const dependencies = {
    desktopAuth: {
      authenticateWebSocket: () => false
    },
    authenticateWebSocket: () => {
      authenticated = true;
      return { userId: 1, username: 'owner' };
    }
  };

  assert.equal(verifyWebSocketClient({ req: { url: '/ws', headers: {} } }, dependencies), false);
  assert.equal(authenticated, false);
});

test('WebSocket authentication attaches the implicit owner after the desktop-key gate passes', () => {
  const request = { url: '/ws', headers: {} };
  const dependencies = {
    desktopAuth: {
      authenticateWebSocket: () => true
    },
    authenticateWebSocket: () => ({ userId: 1, username: 'owner' })
  };

  assert.equal(verifyWebSocketClient({ req: request }, dependencies), true);
  assert.deepEqual(request.user, { userId: 1, username: 'owner' });
});
