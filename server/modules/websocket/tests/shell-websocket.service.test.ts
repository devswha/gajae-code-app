import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import pty from 'node-pty';
import type { WebSocket } from 'ws';

import { handleShellConnection } from '../services/shell-websocket.service.js';

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Array<{ type: string; data?: string }> = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  message(value: unknown) { this.emit('message', JSON.stringify(value)); }
  close() { this.readyState = 3; this.emit('close'); }
}

class FakePty {
  writes: string[] = [];
  killed = false;
  private output?: (value: string) => void;
  private exited?: (value: { exitCode: number }) => void;
  onData(callback: (value: string) => void) { this.output = callback; return { dispose() {} }; }
  onExit(callback: (value: { exitCode: number }) => void) { this.exited = callback; return { dispose() {} }; }
  write(value: string) { this.writes.push(value); }
  resize() {}
  emitOutput(value: string) { this.output?.(value); }
  kill() { this.killed = true; this.exited?.({ exitCode: 0 }); }
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'shell-ownership-'));
  const children: FakePty[] = [];
  const sockets: FakeSocket[] = [];
  t.mock.method(pty, 'spawn', () => {
    const child = new FakePty();
    children.push(child);
    return child as never;
  });
  const connect = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    handleShellConnection(socket as unknown as WebSocket, {
      resolveProviderSessionId: () => undefined,
      stripAnsiSequences: (value) => value,
      normalizeDetectedUrl: () => null,
      extractUrlsFromText: () => [],
      shouldAutoOpenUrlFromOutput: () => false,
    });
    return socket;
  };
  const init = (socket: FakeSocket, sessionId: string) => socket.message({
    type: 'init', projectPath: root, sessionId, isPlainShell: true, initialCommand: 'fixture-only',
  });
  t.after(async () => {
    sockets.forEach((socket) => socket.close());
    children.forEach((child) => child.kill());
    await rm(root, { recursive: true, force: true });
  });
  return { connect, init, children };
}

test('closing a replaced shell socket cannot detach its replacement or accept stale input', async (t) => {
  const { connect, init, children } = await fixture(t);
  const old = connect();
  init(old, 'one');
  const current = connect();
  init(current, 'one');
  assert.equal(children.length, 1);
  old.message({ type: 'input', data: 'stale-command' });
  assert.deepEqual(children[0].writes, []);
  old.close();
  children[0].emitOutput('replacement-output');
  assert.equal(current.sent.at(-1)?.data, 'replacement-output');
  current.message({ type: 'input', data: 'current-command' });
  assert.deepEqual(children[0].writes, ['current-command']);
});

test('reinitializing a shell socket keeps old output in the old session buffer', async (t) => {
  const { connect, init, children } = await fixture(t);
  const current = connect();
  init(current, 'one');
  init(current, 'two');
  assert.equal(children.length, 2);
  const before = current.sent.length;
  children[0].emitOutput('first-session-output');
  assert.equal(current.sent.length, before);
  children[1].emitOutput('second-session-output');
  assert.equal(current.sent.at(-1)?.data, 'second-session-output');
  const first = connect();
  init(first, 'one');
  assert.equal(children.length, 2);
  assert.equal(first.sent.some((frame) => frame.data === 'first-session-output'), true);
});

test('an old shell exit cannot clear the currently attached terminal', async (t) => {
  const { connect, init, children } = await fixture(t);
  const current = connect();
  init(current, 'one');
  init(current, 'two');
  children[0].kill();
  current.message({ type: 'input', data: 'still-current' });
  assert.deepEqual(children[1].writes, ['still-current']);
});
