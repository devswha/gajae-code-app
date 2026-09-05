import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import test from 'node:test';

import pty, { type IPty } from 'node-pty';
import { WebSocket } from 'ws';

import { handleShellConnection } from './shell-websocket.service.js';

const GRACE_PERIOD = 30 * 60 * 1000;

class FakePty {
  readonly writes: string[] = [];
  readonly sizes: Array<[number, number]> = [];
  kills = 0;
  private data?: (chunk: string) => void;
  private exited?: (status: { exitCode: number }) => void;
  onData(callback: (chunk: string) => void) { this.data = callback; return { dispose() {} }; }
  onExit(callback: (status: { exitCode: number }) => void) { this.exited = callback; return { dispose() {} }; }
  write(data: string) { this.writes.push(data); }
  resize(cols: number, rows: number) { this.sizes.push([cols, rows]); }
  kill() { this.kills++; }
  output(data: string) { this.data?.(data); }
  exit() { this.exited?.({ exitCode: 0 }); }
}

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  readonly frames: Array<{ type: string; data?: string; message?: string }> = [];
  send(data: string) { this.frames.push(JSON.parse(data)); }
  receive(frame: Record<string, unknown>) { this.emit('message', Buffer.from(JSON.stringify(frame))); }
  close() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
  output() { return this.frames.map(frame => frame.data ?? '').join(''); }
}

function fixture(t: test.TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeout = t.mock.method(globalThis, 'setTimeout');
  const terminals: FakePty[] = [];
  t.mock.method(pty, 'spawn', () => {
    const terminal = new FakePty();
    terminals.push(terminal);
    return terminal as unknown as IPty;
  });
  t.after(() => { for (const terminal of terminals) terminal.exit(); });
  const init = { type: 'init', projectPath: os.tmpdir(), sessionId: randomUUID(), isPlainShell: true, initialCommand: 'fixture-shell' };
  const connect = () => {
    const socket = new FakeSocket();
    handleShellConnection(socket as unknown as WebSocket, {
      resolveProviderSessionId: () => undefined,
      stripAnsiSequences: value => value,
      normalizeDetectedUrl: () => null,
      extractUrlsFromText: () => [],
      shouldAutoOpenUrlFromOutput: () => false,
    });
    return socket;
  };
  return { init, connect, terminals, timeout };
}

test('closing replaced A preserves B output and schedules no cleanup timer', t => {
  const f = fixture(t);
  const a = f.connect(); a.receive(f.init);
  const terminal = f.terminals[0]!;
  terminal.output('before-reconnect');
  const b = f.connect(); b.receive(f.init);
  assert.match(b.output(), /Reconnected to existing session.*before-reconnect/s);
  assert.equal(f.terminals.length, 1);
  a.close();
  assert.equal(f.timeout.mock.callCount(), 0);
  terminal.output('after-old-close');
  assert.match(b.output(), /after-old-close/);
  assert.doesNotMatch(a.output(), /after-old-close/);
  t.mock.timers.tick(GRACE_PERIOD + 1);
  assert.equal(terminal.kills, 0);
  terminal.output('still-owned');
  assert.match(b.output(), /still-owned/);
});

test('superseded sockets cannot input, resize, exit or force-restart the active terminal', t => {
  const f = fixture(t);
  const a = f.connect(); a.receive(f.init);
  const b = f.connect(); b.receive(f.init);
  const terminal = f.terminals[0]!;
  a.receive({ type: 'input', data: 'exit\n\u0004' });
  a.receive({ type: 'resize', cols: 1, rows: 1 });
  a.receive({ ...f.init, forceRestart: true });
  a.receive({ ...f.init, initialCommand: 'gjc auth login' });
  a.receive({ type: 'close' }); // Not a supported command; must remain harmless.
  assert.deepEqual(terminal.writes, []);
  assert.deepEqual(terminal.sizes, []);
  assert.equal(terminal.kills, 0);
  assert.equal(f.terminals.length, 1);
  b.receive({ type: 'input', data: 'current-owner\n' });
  b.receive({ type: 'resize', cols: 97, rows: 31 });
  assert.deepEqual(terminal.writes, ['current-owner\n']);
  assert.deepEqual(terminal.sizes, [[97, 31]]);
  assert.equal(f.timeout.mock.callCount(), 0);
});

test('owner disconnect buffers output, reconnect cancels expiry, and only the next owner close expires it', t => {
  const f = fixture(t);
  const a = f.connect(); a.receive(f.init);
  const terminal = f.terminals[0]!;
  a.close();
  assert.equal(f.timeout.mock.callCount(), 1);
  const oldExpiry = f.timeout.mock.calls[0]!.arguments[0];
  terminal.output('while-disconnected');
  t.mock.timers.tick(GRACE_PERIOD - 1);
  assert.equal(terminal.kills, 0);
  const b = f.connect(); b.receive(f.init);
  assert.match(b.output(), /while-disconnected/);
  // Even an already queued callback must not kill a reattached session.
  oldExpiry();
  t.mock.timers.tick(2);
  assert.equal(terminal.kills, 0);
  terminal.output('after-cancelled-expiry');
  assert.match(b.output(), /after-cancelled-expiry/);
  b.close();
  assert.equal(f.timeout.mock.callCount(), 2);
  t.mock.timers.tick(GRACE_PERIOD);
  assert.equal(terminal.kills, 1);
  const c = f.connect(); c.receive(f.init);
  assert.equal(f.terminals.length, 2);
  assert.doesNotMatch(c.output(), /Reconnected/);
});

test('current owner can restart and late output or exit from the old PTY cannot affect its replacement', t => {
  const f = fixture(t);
  const a = f.connect(); a.receive(f.init);
  const original = f.terminals[0]!;
  const b = f.connect(); b.receive(f.init);
  b.receive({ ...f.init, forceRestart: true });
  assert.equal(original.kills, 1);
  assert.equal(f.terminals.length, 2);
  const replacement = f.terminals[1]!;
  original.output('retired-output');
  original.exit();
  assert.doesNotMatch(b.output(), /retired-output|Process exited/);
  a.receive({ type: 'input', data: 'stale-exit\n' });
  a.close();
  b.receive({ type: 'input', data: 'replacement-owner\n' });
  replacement.output('replacement-output');
  assert.deepEqual(original.writes, []);
  assert.deepEqual(replacement.writes, ['replacement-owner\n']);
  assert.match(b.output(), /replacement-output/);
  assert.equal(f.timeout.mock.callCount(), 0);
});

test('the reconnected owner can start a fresh terminal after the previous PTY exits', t => {
  const f = fixture(t);
  const a = f.connect(); a.receive(f.init);
  const b = f.connect(); b.receive(f.init);
  f.terminals[0]!.exit();
  assert.match(b.output(), /Process exited with code 0/);
  b.receive({ type: 'input', data: 'after-exit\n' });
  assert.deepEqual(f.terminals[0]!.writes, []);
  b.receive(f.init);
  assert.equal(f.terminals.length, 2);
  b.receive({ type: 'input', data: 'fresh\n' });
  assert.deepEqual(f.terminals[1]!.writes, ['fresh\n']);
});

test('switching sessions detaches the old PTY without redirecting its output or exit', t => {
  const f = fixture(t);
  const a = f.connect(); a.receive(f.init);
  const original = f.terminals[0]!;
  a.receive({ ...f.init, sessionId: randomUUID() });
  const replacement = f.terminals[1]!;
  assert.equal(f.timeout.mock.callCount(), 1);
  original.output('old-session-buffer');
  assert.doesNotMatch(a.output(), /old-session-buffer/);
  const b = f.connect(); b.receive(f.init);
  assert.match(b.output(), /old-session-buffer/);
  original.exit();
  assert.match(b.output(), /Process exited with code 0/);
  assert.doesNotMatch(a.output(), /Process exited/);
  a.receive({ type: 'input', data: 'new-session\n' });
  replacement.output('new-session-output');
  assert.deepEqual(replacement.writes, ['new-session\n']);
  assert.match(a.output(), /new-session-output/);
});

test('an invalid re-init leaves the current binding and output intact', t => {
  const f = fixture(t);
  const a = f.connect(); a.receive(f.init);
  a.receive({ ...f.init, sessionId: 'invalid/session' });
  assert.ok(a.frames.some(frame => frame.message === 'Invalid session ID'));
  a.receive({ type: 'input', data: 'valid-owner\n' });
  f.terminals[0]!.output('still-valid');
  assert.deepEqual(f.terminals[0]!.writes, ['valid-owner\n']);
  assert.match(a.output(), /still-valid/);
  assert.equal(f.timeout.mock.callCount(), 0);
});
