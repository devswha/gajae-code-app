import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test, { type TestContext } from 'node:test';

import { DesktopNativeInit } from '../../shared/desktop-native-init.js';

import { TauriBrowserClient } from './tauri-browser-client.js';

const pageBinding = { windowEpoch: 'window-one', documentEpoch: 1, origin: 'https://example.com' };
const page = { sessionId: 'one', activeTabId: 'page', tabs: [{ id: 'page', title: 'Example Domain', url: 'https://example.com/', loading: false, canGoBack: false, canGoForward: false }], binding: pageBinding, profileMode: 'persistent' };
const idle = { owner: 'browser', generation: 'native-1', complete: true, starting: 0, queued: 0, running: 0, settling: 0, approvals: 0, retained: 0, unknown: [] };

async function fixture(t: TestContext, options: { badProof?: boolean; handle?: (request: any, socket: net.Socket) => void } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gjc-native-'));
  const binding = { protocolVersion: 1, socket: join(dir, 'browser.sock'), secret: 'a'.repeat(64), epoch: 'b'.repeat(64) };
  const requests: any[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let bytes = '';
    socket.on('data', (chunk) => {
      bytes += chunk.toString();
      const newline = bytes.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(bytes.slice(0, newline));
      bytes = bytes.slice(newline + 1);
      requests.push(request);
      if (request.kind === 'challenge') {
        const proof = options.badProof ? '0'.repeat(64) : createHmac('sha256', binding.secret)
          .update(`gajae-native-browser-v1\0${binding.epoch}\0${request.nonce}`).digest('hex');
        socket.write(`${JSON.stringify({ protocolVersion: 1, kind: 'challenge', epoch: binding.epoch, nonce: request.nonce, proof })}\n`);
      } else if (options.handle) options.handle(request, socket);
      else reply(request, socket, request.operation === 'status' ? { ready: true, activity: idle } : page);
    });
  });
  server.listen(binding.socket);
  await once(server, 'listening');
  const input = new PassThrough();
  const initialization = new DesktopNativeInit({ input, platform: 'darwin', env: { GJC_DESKTOP: '1', GJC_DESKTOP_PIPE: '1' } });
  const client = new TauriBrowserClient({ initialization });
  input.write(`GJC_DESKTOP_INIT ${JSON.stringify({ protocolVersion: 2, browser: binding, update: null })}\n`);
  t.after(async () => {
    await client.shutdown();
    initialization.retire();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  return { client, input, requests, binding };
}

function reply(request: any, socket: net.Socket, result: unknown) {
  socket.write(`${JSON.stringify({ protocolVersion: 1, id: request.id, epoch: request.epoch, sessionId: request.sessionId, ok: true, result })}\n`);
}

test('native readiness requires authenticated status, then state and exact page binding cross the same endpoint', async (t) => {
  const { client, requests } = await fixture(t);
  assert.equal(client.isReady(), false);
  assert.equal((await client.status()).ready, true);
  assert.equal(client.isReady(), true);
  assert.deepEqual(await client.open('one', { url: 'https://example.com/' }), page);
  await client.command('one', { action: 'fill', selector: '#name', text: 'Ada' }, pageBinding);
  const sent = requests.find((request) => request.operation === 'command');
  assert.deepEqual(sent.expected, pageBinding);
  assert.deepEqual(sent.payload.command, { action: 'fill', selector: '#name', text: 'Ada' });
  assert.equal(sent.pid, process.pid);
  assert.ok(sent.timeoutMs > 0 && sent.timeoutMs <= 30_000);
});

test('an unproven endpoint receives neither secret nor browser commands', async (t) => {
  const { client, requests } = await fixture(t, { badProof: true });
  await assert.rejects(client.open('one', {}), /browser_unauthorized/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, 'challenge');
  assert.equal(requests[0].secret, undefined);
  assert.equal(requests[0].payload, undefined);
});

test('another session state and mismatched response correlation are rejected', async (t) => {
  const other = await fixture(t, { handle: (request, socket) => reply(request, socket, { ...page, sessionId: 'other' }) });
  await assert.rejects(other.client.state('one'), /browser_protocol_error/);
  const wrong = await fixture(t, { handle: (request, socket) => reply({ ...request, id: 'wrong' }, socket, page) });
  await assert.rejects(wrong.client.state('one'), /browser_protocol_error/);
});

test('abort closes its request but native running work remains visible to restart admission', async (t) => {
  let dispatched!: () => void;
  const seen = new Promise<void>((resolve) => { dispatched = resolve; });
  let work = 0;
  const { client } = await fixture(t, { handle: (request, socket) => {
    if (request.operation === 'status') reply(request, socket, { ready: true, activity: { ...idle, generation: `native-${work}`, running: work } });
    else { work = 1; dispatched(); }
  } });
  const controller = new AbortController();
  const command = client.command('one', { action: 'click', selector: '#submit' }, pageBinding, controller.signal);
  await seen;
  controller.abort();
  await assert.rejects(command, /browser_cancelled/);
  assert.equal((await client.snapshotActivity()).running, 1);
  work = 0;
  assert.equal((await client.snapshotActivity()).running, 0);
});

test('retiring the native launch invalidates capability and keeps restart fail-closed', async (t) => {
  const { client, input } = await fixture(t);
  await client.status();
  input.emit('error', new Error('supervisor stopped'));
  assert.equal(client.isReady(), false);
  const activity = await client.snapshotActivity();
  assert.equal(activity.complete, false);
  assert.ok(activity.unknown.includes('builtin_browser_unconfirmed'));
});

test('native protocol input is bounded and an unconfigured self-host remains usable without a browser', async (t) => {
  const { client } = await fixture(t, { handle: (_request, socket) => socket.write('x'.repeat(256 * 1024 + 1)) });
  await assert.rejects(client.state('one'), /browser_protocol_error/);
  const selfhost = new TauriBrowserClient();
  assert.equal((await selfhost.status()).ready, false);
  assert.equal((await selfhost.snapshotActivity()).complete, true);
  await assert.rejects(selfhost.open('one', {}), /builtin_browser_unavailable/);
});
