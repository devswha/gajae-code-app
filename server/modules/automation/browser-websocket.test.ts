import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';

import type WebSocket from 'ws';

import type { BrowserEventFrame } from './browser-protocol.js';
import { handleBrowserConnection } from './browser-websocket.js';

class FakeWebSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  bufferedAmount = 0;
  sent: Array<string | Buffer> = [];

  send(value: string | Buffer): void {
    this.sent.push(value);
  }

  close(): void {
    this.readyState = 3;
    this.emit('close');
  }
}

test('an open browser websocket resubscribes after the sidecar session is recreated', async () => {
  const socket = new FakeWebSocket();
  let listener: ((event: BrowserEventFrame) => void) | undefined;
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const service = {
    subscribeBrowser(next: (event: BrowserEventFrame) => void) {
      listener = next;
      return () => { listener = undefined; };
    },
    browser: {
      async subscribeFrames() {
        subscribeCalls += 1;
        return { sessionId: 'session-1', activeTabId: 'tab-1', tabs: [{ id: 'tab-1' }] };
      },
      async unsubscribeFrames() { unsubscribeCalls += 1; },
    },
  };

  handleBrowserConnection(
    socket as unknown as WebSocket,
    { url: '/ws/browser?sessionId=session-1' } as IncomingMessage,
    service,
  );
  assert.equal(subscribeCalls, 1);
  assert.ok(listener);
  await Promise.resolve();
  assert.deepEqual(JSON.parse(String(socket.sent[0])), {
    type: 'state',
    sessionId: 'session-1',
    payload: { sessionId: 'session-1', activeTabId: 'tab-1', tabs: [{ id: 'tab-1' }] },
  });

  listener({
    protocolVersion: 1,
    kind: 'event',
    method: 'state',
    sessionId: 'session-1',
    payload: { sessionId: 'session-1', activeTabId: null, tabs: [] },
  });
  listener({
    protocolVersion: 1,
    kind: 'event',
    method: 'state',
    sessionId: 'session-1',
    payload: { sessionId: 'session-1', activeTabId: 'tab-1', tabs: [{ id: 'tab-1' }] },
  });
  await Promise.resolve();
  assert.equal(subscribeCalls, 2);

  // Subsequent state updates for the same live sidecar session do not stack
  // redundant screencast subscriptions.
  listener({
    protocolVersion: 1,
    kind: 'event',
    method: 'state',
    sessionId: 'session-1',
    payload: { sessionId: 'session-1', activeTabId: 'tab-1', tabs: [{ id: 'tab-1' }] },
  });
  await Promise.resolve();
  assert.equal(subscribeCalls, 2);

  socket.close();
  await Promise.resolve();
  assert.equal(unsubscribeCalls, 1);
});
