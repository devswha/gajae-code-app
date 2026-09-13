import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { WebSocketServer } from 'ws';

import { listenForStartup } from './server-listener.js';

async function close(server: net.Server) {
  await new Promise<void>(resolve => server.close(() => resolve()));
}

/** Node decorates a failed listen with the address and port it refused. */
type BindError = NodeJS.ErrnoException & { address?: string; port?: number };

test('HTTP bind failure forwarded by ws rejects without an unhandled WebSocketServer error', async () => {
  const owner = http.createServer();
  owner.listen(0, '127.0.0.1'); await once(owner, 'listening');
  const server = http.createServer(); const sockets = new WebSocketServer({ server });
  try {
    await assert.rejects(listenForStartup(server, sockets, (owner.address() as net.AddressInfo).port, '127.0.0.1', async () => {
      throw new Error('readiness must not run after failed bind');
    }), { code: 'EADDRINUSE' });
    assert.equal(owner.listening, true);
    assert.equal(sockets.listenerCount('error'), 0);
  } finally { sockets.close(); await close(server); await close(owner); }
});

test('listening alone does not finish initialization; readiness failure remains observable', async () => {
  const server = http.createServer(); const sockets = new WebSocketServer({ server });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let done = false;
  const started = listenForStartup(server, sockets, 0, '127.0.0.1', async () => { await gate; }).then(() => { done = true; });
  try {
    await once(server, 'listening');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(done, false);
    release(); await started;
    assert.equal(done, true);
  } finally { release(); sockets.close(); await close(server); }
  const second = http.createServer(); const secondSockets = new WebSocketServer({ server: second });
  try { await assert.rejects(listenForStartup(second, secondSockets, 0, '127.0.0.1', async () => { throw new Error('ready failed'); }), /ready failed/); }
  finally { secondSockets.close(); await close(second); }
});

test('the actual index startup failure joins cleanup and removes only its owned Unix socket', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gjc-listen-'));
  const socketPath = path.join(directory, 'a.sock');
  const owner = http.createServer(); owner.listen(0, '127.0.0.1'); await once(owner, 'listening');
  const server = http.createServer(); const wss = new WebSocketServer({ server });
  const automation = net.createServer();
  let exited!: (code: number) => void;
  const completion = new Promise<number>(resolve => { exited = resolve; });
  let markerWrites = 0; let automationStopped = false;
  const source = ts.createSourceFile('index.js', readFileSync(new URL('../index.js', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const startup = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'startServer');
  assert.ok(startup);
  const identity = (value: unknown) => value;
  const context = {
    enterInternalActivity: () => () => {}, markInternalActivityUncertain() {},
    desktopRestartAdmission: { state: 'open' },
    initializeDatabase: async () => {},
    automationService: {
      startBridge: async () => { automation.listen(socketPath); await once(automation, 'listening'); },
      shutdown: async () => { await close(automation); automationStopped = true; },
    },
    gjcJobOrchestrator: { reconcile: async () => {}, interruptForShutdown: async () => {}, close() {} },
    evaluateExposure: () => ({ level: 'allow' }),
    fs: { existsSync: () => false }, path, APP_ROOT: directory,
    c: { info: identity, warn: identity, bright: identity, dim: identity, tip: identity }, console: { log() {}, warn() {}, error() {} },
    SERVER_PORT: (owner.address() as net.AddressInfo).port, HOST: '127.0.0.1', DISPLAY_HOST: '127.0.0.1', VITE_PORT: 5173,
    process: { env: {}, on() {}, exitCode: 0, exit: (code: number) => { assert.equal(automationStopped, true); exited(code); } },
    server, wss, listenForStartup,
    writeLocalServerMarker: async () => { markerWrites++; }, removeLocalServerMarker: async () => {},
    initializeSessionsWatcher: async () => {}, closeSessionsWatcher: async () => {},
    drainWebSocketClients: async () => {}, shutdownGjcWorker: async () => {},
    setInterval: () => { throw new Error('unexpected incomplete cleanup'); },
  };
  try {
    const run = runInNewContext(`(${startup.getText(source)})`, context) as () => Promise<void>;
    await run();
    assert.equal(await completion, 1);
    assert.equal(markerWrites, 0);
    await assert.rejects(lstat(socketPath), { code: 'ENOENT' });
    assert.equal(owner.listening, true);
  } finally {
    wss.close(); await close(server); await close(automation); await close(owner);
    await rm(directory, { recursive: true, force: true });
  }
});

test('an error during readiness does not release the callback owner before its real completion', async () => {
  const server = http.createServer(); const sockets = new WebSocketServer({ server });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  const pending = listenForStartup(server, sockets, 0, '127.0.0.1', async () => { await gate; });
  const checked = assert.rejects(pending, /during ready/).then(() => { settled = true; });
  try {
    await once(server, 'listening');
    server.emit('error', new Error('during ready'));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    release(); await checked;
  } finally { release(); sockets.close(); await close(server); }
});

/**
 * Incident reproduction: the desktop asks for a remembered `desktop-port` that
 * some unrelated program already owns. This is the EADDRINUSE path observed on
 * 127.0.0.1:60278. The fixture never inspects or terminates a real foreign
 * process: an in-process listener stands in for the unrelated owner.
 */
test('reproduction: an unrelated listener owning the desktop port fails startup without disturbing it', async () => {
  // A plain TCP listener, not an HTTP/gajae server: it answers no /health.
  const foreign = net.createServer(socket => socket.destroy());
  foreign.listen(0, '127.0.0.1'); await once(foreign, 'listening');
  const requestedPort = (foreign.address() as net.AddressInfo).port;
  const server = http.createServer(); const sockets = new WebSocketServer({ server });
  try {
    const failure = await listenForStartup(server, sockets, requestedPort, '127.0.0.1', async () => {
      throw new Error('readiness must not run when the port is taken');
    }).then(() => null, (error: BindError) => error);

    assert.ok(failure, 'binding an occupied port must fail');
    assert.equal(failure.code, 'EADDRINUSE');
    // The evidence an operator needs: which address:port was refused.
    assert.equal(failure.address, '127.0.0.1');
    assert.equal(failure.port, requestedPort);
    // The requested port is knowable even though no actual port was bound.
    assert.equal(server.address(), null, 'a refused bind has no actual port');
    // Recovery must not depend on evicting the occupant.
    assert.equal(foreign.listening, true, 'the unrelated owner must be left alone');
  } finally { sockets.close(); await close(server); await close(foreign); }
});

/**
 * Investigation: why one failure can look like several.
 *
 * `ws` re-emits the HTTP server's `error` on the WebSocketServer
 * (node_modules/ws/lib/websocket-server.js: `error: this.emit.bind(this, 'error')`).
 * A single OS-level bind refusal is therefore delivered twice, to two
 * emitters, as the *same* Error object. Duplicate observations of one failure
 * are not evidence that two servers were spawned.
 */
test('investigation: one bind refusal is delivered twice but is a single error and a single bind', async () => {
  const foreign = net.createServer();
  foreign.listen(0, '127.0.0.1'); await once(foreign, 'listening');
  const requestedPort = (foreign.address() as net.AddressInfo).port;
  const server = http.createServer(); const sockets = new WebSocketServer({ server });
  const observed: Error[] = [];
  server.on('error', error => observed.push(error));
  sockets.on('error', error => observed.push(error));
  let readyRuns = 0;
  try {
    await assert.rejects(
      listenForStartup(server, sockets, requestedPort, '127.0.0.1', async () => { readyRuns++; }),
      { code: 'EADDRINUSE' },
    );
    await new Promise<void>(resolve => setImmediate(resolve));

    assert.equal(observed.length, 2, 'the http server and ws both report the same refusal');
    assert.equal(observed[0], observed[1], 'both deliveries are one Error instance, not two failures');
    assert.equal(readyRuns, 0, 'a refused bind never starts readiness');
    assert.equal(server.address(), null, 'exactly zero listeners were established here');
    assert.equal(foreign.listening, true);
  } finally { sockets.close(); await close(server); await close(foreign); }
});

/**
 * Reproduction: repeated Retry against a still-occupied port. Each attempt
 * fails independently and identically; repetition in a log is explained by
 * repeated attempts, not by a second server having been started.
 */
test('reproduction: repeated retries against an occupied port fail identically and bind nothing', async () => {
  const foreign = net.createServer();
  foreign.listen(0, '127.0.0.1'); await once(foreign, 'listening');
  const requestedPort = (foreign.address() as net.AddressInfo).port;
  const codes: string[] = [];
  const bound: (string | net.AddressInfo | null)[] = [];
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const server = http.createServer(); const sockets = new WebSocketServer({ server });
      const failure = await listenForStartup(server, sockets, requestedPort, '127.0.0.1', async () => {
        throw new Error('readiness must not run');
      }).then(() => null, (error: NodeJS.ErrnoException) => error);
      codes.push(failure?.code ?? 'none');
      bound.push(server.address());
      sockets.close(); await close(server);
    }
    assert.deepEqual(codes, ['EADDRINUSE', 'EADDRINUSE', 'EADDRINUSE']);
    assert.deepEqual(bound, [null, null, null], 'no retry ever established a listener');
    assert.equal(foreign.listening, true, 'retrying never evicts the occupant');
  } finally { await close(foreign); }
});

/**
 * Control: with the port free, the same call binds an actual port that can
 * differ from the requested one. Requested and actual port are distinct facts
 * and an incident record must not conflate them.
 */
test('an OS-assigned request binds an actual port distinct from the request', async () => {
  const server = http.createServer(); const sockets = new WebSocketServer({ server });
  try {
    await listenForStartup(server, sockets, 0, '127.0.0.1', async () => {});
    const actual = server.address() as net.AddressInfo;
    assert.ok(actual && actual.port > 0, 'an accepted bind reports its actual port');
    assert.notEqual(actual.port, 0, 'the requested 0 is not the actual port');
    assert.equal(actual.address, '127.0.0.1');
  } finally { sockets.close(); await close(server); }
});
