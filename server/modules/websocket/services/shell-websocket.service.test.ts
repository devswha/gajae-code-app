import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import pty, { type IPty, type IPtyForkOptions } from 'node-pty';
import { type WebSocket } from 'ws';

import { handleShellConnection } from './shell-websocket.service.js';

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Array<{ type: string; data?: string; message?: string }> = [];
  send(value: string): void { this.sent.push(JSON.parse(value)); }
}

function connect(t: TestContext, platform: NodeJS.Platform, nativeId: string | null = 'provider-native-id') {
  const socket = new FakeSocket();
  const projectPath = mkdtempSync(path.join(os.tmpdir(), 'gajae-shell-ws-'));
  const calls: Array<{ executable: string; args: string[]; options: IPtyForkOptions }> = [];
  const exits: Array<(status: { exitCode: number }) => void> = [];
  t.mock.method(os, 'platform', () => platform);
  t.mock.method(pty, 'spawn', (executable: string, args: string[], options: IPtyForkOptions) => {
    calls.push({ executable, args, options });
    return {
      onData() {},
      onExit(callback: (status: { exitCode: number }) => void) { exits.push(callback); },
      kill() {}, write() {}, resize() {},
    } as unknown as IPty;
  });
  handleShellConnection(socket as unknown as WebSocket, {
    resolveProviderSessionId: () => nativeId,
    stripAnsiSequences: (content) => content,
    normalizeDetectedUrl: () => null,
    extractUrlsFromText: () => [],
    shouldAutoOpenUrlFromOutput: () => false,
  });
  t.after(() => {
    exits.forEach((exit) => exit({ exitCode: 0 }));
    socket.emit('close');
    rmSync(projectPath, { recursive: true, force: true });
  });
  return {
    socket, calls, projectPath,
    init: (data: Record<string, unknown>) => socket.emit('message', JSON.stringify({ type: 'init', projectPath, ...data })),
  };
}

test('Windows websocket GJC resume reaches the PTY with PowerShell syntax and the mapped ID', (t) => {
  const connection = connect(t, 'win32');
  connection.init({ provider: 'gjc', sessionId: 'app-session-id', hasSession: true });
  assert.equal(connection.calls.length, 1);
  const { executable, args, options } = connection.calls[0];
  assert.match(executable, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
  assert.deepEqual(args.slice(0, -1), ['-NoLogo', '-NoProfile', '-EncodedCommand']);
  const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
  assert.match(script, / --resume 'provider-native-id'; if \(-not \$\?\)/);
  assert.doesNotMatch(script, /app-session-id|\|\|/);
  assert.equal(options.cwd, connection.projectPath);
  assert.deepEqual(Object.keys(options.env ?? {}).filter((key) => key.toLowerCase() === 'path'), ['PATH']);
});

test('Windows websocket plain terminal stays interactive when no initial command is supplied', (t) => {
  const connection = connect(t, 'win32');
  connection.init({ provider: 'plain-shell', isPlainShell: true });
  assert.equal(connection.calls.length, 1);
  assert.deepEqual(connection.calls[0].args, ['-NoLogo', '-NoProfile']);
});

test('Windows websocket preserves explicit provider/login command syntax through PTY argv', (t) => {
  const connection = connect(t, 'win32');
  const initialCommand = '& "C:\\Provider Tools\\cursor-agent.exe" login; Write-Output \'한글 $literal\'';
  connection.init({ provider: 'cursor', initialCommand });
  assert.equal(connection.calls.length, 1);
  assert.equal(Buffer.from(connection.calls[0].args.at(-1)!, 'base64').toString('utf16le'), initialCommand);
});

test('Windows websocket never interpolates a malformed provider session ID', (t) => {
  const connection = connect(t, 'win32', "native'; calc; '");
  connection.init({ provider: 'gjc', sessionId: 'app-session-id', hasSession: true });
  assert.equal(connection.calls.length, 1);
  const script = Buffer.from(connection.calls[0].args.at(-1)!, 'base64').toString('utf16le');
  assert.doesNotMatch(script, /resume|calc|native/);
  assert.match(script, /^& /);
});

test('POSIX websocket resume continues to use bash fallback syntax', (t) => {
  const connection = connect(t, 'linux');
  connection.init({ provider: 'gjc', sessionId: 'app-session-id', hasSession: true });
  assert.equal(connection.calls.length, 1);
  assert.equal(connection.calls[0].executable, 'bash');
  assert.deepEqual(connection.calls[0].args, ['-c', 'gjc --resume "provider-native-id" || gjc']);
});
