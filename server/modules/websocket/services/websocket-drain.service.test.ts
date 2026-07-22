import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  drainWebSocketClients,
  WEBSOCKET_DRAIN_CLOSE_CODE,
  WEBSOCKET_DRAIN_REASON,
} from './websocket-drain.service.js';

class FakeSocket extends EventEmitter {
  readyState = 1;
  readonly closeCalls: Array<[number, string]> = [];
  terminateCalls = 0;

  close(code: number, reason: string): void {
    this.closeCalls.push([code, reason]);
  }

  terminate(): void {
    this.terminateCalls++;
    this.readyState = 3;
    this.emit('close');
  }
}

test('sends the server-draining close frame and does not terminate an immediately closed client', async () => {
  const socket = new FakeSocket();
  socket.close = (code, reason) => {
    socket.closeCalls.push([code, reason]);
    socket.readyState = 3;
    socket.emit('close');
  };

  await drainWebSocketClients([socket], { timeoutMs: 20 });

  assert.deepEqual(socket.closeCalls, [[WEBSOCKET_DRAIN_CLOSE_CODE, WEBSOCKET_DRAIN_REASON]]);
  assert.equal(socket.terminateCalls, 0);
});

test('waits for a delayed peer close without terminating the client', async () => {
  const socket = new FakeSocket();
  socket.close = (code, reason) => {
    socket.closeCalls.push([code, reason]);
    setTimeout(() => {
      socket.readyState = 3;
      socket.emit('close');
    }, 5);
  };

  await drainWebSocketClients([socket], { timeoutMs: 40 });

  assert.deepEqual(socket.closeCalls, [[1001, 'server-draining']]);
  assert.equal(socket.terminateCalls, 0);
});

test('terminates clients that never acknowledge the close frame', async () => {
  const socket = new FakeSocket();

  await drainWebSocketClients([socket], { timeoutMs: 5 });

  assert.deepEqual(socket.closeCalls, [[1001, 'server-draining']]);
  assert.equal(socket.terminateCalls, 1);
});

test('does not close or terminate an already closed client', async () => {
  const socket = new FakeSocket();
  socket.readyState = 3;

  await drainWebSocketClients([socket], { timeoutMs: 5 });

  assert.deepEqual(socket.closeCalls, []);
  assert.equal(socket.terminateCalls, 0);
});

test('completes within the configured bound when clients never close', async () => {
  const socket = new FakeSocket();
  const startedAt = Date.now();

  await drainWebSocketClients([socket], { timeoutMs: 10 });

  assert.ok(Date.now() - startedAt < 100, 'drain exceeded its bounded timeout');
  assert.equal(socket.terminateCalls, 1);
});
