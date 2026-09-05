import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import test, { type TestContext } from 'node:test';

import WebSocket from 'ws';

import { createGjcAppFactory } from '../../app-factory.js';
import { validateApiKey } from '../../middleware/auth.js';

async function fixture(t: TestContext, allowedHosts?: string) {
  const previous = Object.fromEntries(['ALLOWED_HOSTS', 'API_KEY', 'GJC_DESKTOP'].map((key) => [key, process.env[key]]));
  delete process.env.API_KEY;
  delete process.env.GJC_DESKTOP;
  if (allowedHosts === undefined) delete process.env.ALLOWED_HOSTS;
  else process.env.ALLOWED_HOSTS = allowedHosts;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const calls = { starts: 0, lists: 0, sockets: 0 };
  const { server, wss } = createGjcAppFactory({
    authority: { list: async () => { calls.lists++; return { items: [{ jobId: 'private-job' }] }; } },
    orchestrator: {
      deps: {},
      start: async () => { calls.starts++; return { jobId: 'fixture-job', runId: 'fixture-run' }; },
    },
    gitService: {},
    projection: { publish() {} },
    terminalNotificationAdapter: undefined,
    authenticateWebSocket: () => ({ userId: 'fixture-owner', username: 'fixture-owner' }),
    authenticateGjcRoute: (_request: unknown, _response: unknown, next: () => void) => next(),
    validateApiKey,
    chat: {} as never,
    shell: {} as never,
    browser: ((socket: WebSocket) => { calls.sockets++; socket.send('fixture-browser'); }) as never,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    calls,
    request: (headers: Record<string, string>, method = 'POST') => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const payload = method === 'POST' ? JSON.stringify({ projectPath: '/fixture-only', message: 'never call a model' }) : undefined;
      const request = httpRequest({
        hostname: '127.0.0.1', port: address.port, path: '/api/gjc/jobs', method,
        headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers },
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      });
      request.once('error', reject);
      request.end(payload);
    }),
    connect: (headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/browser`, { headers });
      let rejectedHandshake = false;
      socket.once('unexpected-response', (_request, response) => {
        rejectedHandshake = true;
        response.resume();
        socket.terminate();
        resolve(response.statusCode ?? 0);
      });
      socket.once('message', () => { socket.terminate(); resolve(101); });
      socket.once('error', (error) => {
        // terminate() after a rejected handshake has no established socket.
        if (!rejectedHandshake) reject(error);
      });
    }),
  };
}

test('configured host admission blocks a rebinding-shaped request before the real job-start route', async (t) => {
  const server = await fixture(t, 'studio.example,.trusted.test');
  const response = await server.request({ host: 'attacker.example', origin: 'http://attacker.example' });
  assert.equal(response.status, 403);
  assert.equal(server.calls.starts, 0);
  assert.equal(response.body.includes('fixture-job'), false);
});

test('a same-origin GET without Origin cannot bypass configured host admission or spoof a proxy', async (t) => {
  const server = await fixture(t, 'studio.example');
  const candidates: Array<Record<string, string>> = [
    { host: 'attacker.example' },
    { host: 'attacker.example', 'x-forwarded-host': 'studio.example', 'x-forwarded-proto': 'https' },
  ];
  for (const headers of candidates) {
    const response = await server.request(headers, 'GET');
    assert.equal(response.status, 403);
    assert.equal(response.body.includes('private-job'), false);
  }
  assert.equal(server.calls.lists, 0);
});

test('loopback, literal remote addresses and configured HTTPS reverse proxies still reach the real routes', async (t) => {
  const server = await fixture(t, 'studio.example,.trusted.test');
  const allowed: Array<Record<string, string>> = [
    { host: '127.0.0.1:3001', origin: 'http://localhost:5173' },
    { host: 'localhost:3001', origin: 'http://127.0.0.1:5173' },
    { host: '100.78.133.28:3001', origin: 'http://100.78.133.28:5173' },
    { host: 'studio.example', origin: 'https://studio.example', 'x-forwarded-proto': 'https' },
    { host: 'mac.trusted.test', origin: 'https://mac.trusted.test' },
    { host: '127.0.0.1:3001', origin: 'https://studio.example' },
  ];
  for (const headers of allowed) {
    assert.equal((await server.request(headers)).status, 202, JSON.stringify(headers));
    assert.equal(await server.connect(headers), 101, JSON.stringify(headers));
  }
  assert.equal((await server.request({ host: 'studio.example' }, 'GET')).status, 200);
  assert.equal(server.calls.starts, allowed.length);
  assert.equal(server.calls.sockets, allowed.length);
});

test('configured hosts also reject matching malicious WebSocket Host and Origin', async (t) => {
  const server = await fixture(t, 'studio.example');
  assert.equal(await server.connect({ host: 'attacker.example', origin: 'http://attacker.example' }), 401);
  assert.equal(server.calls.sockets, 0);
});

test('default loopback deployment rejects arbitrary DNS Host names on HTTP and WebSocket routes', async (t) => {
  const server = await fixture(t);
  const headers = { host: 'attacker.example', origin: 'http://attacker.example' };
  const post = await server.request(headers);
  const get = await server.request({ host: 'attacker.example' }, 'GET');
  const websocket = await server.connect(headers);
  assert.deepEqual({ post: post.status, get: get.status, websocket, calls: server.calls }, {
    post: 403, get: 403, websocket: 401, calls: { starts: 0, lists: 0, sockets: 0 },
  });
  for (const forged of [
    { host: 'attacker.example', origin: 'https://attacker.example', 'x-forwarded-proto': 'https' },
    { host: 'attacker.example', 'x-forwarded-host': 'localhost', 'x-forwarded-proto': 'https' },
  ] as Array<Record<string, string>>) {
    assert.equal((await server.request(forged)).status, 403);
    assert.equal(await server.connect(forged), 401);
  }
});

test('default loopback deployment still allows loopback and literal remote IPs', async (t) => {
  const server = await fixture(t);
  for (const headers of [
    { host: 'localhost:3001', origin: 'http://127.0.0.1:5173' },
    { host: '127.0.0.1:3001', origin: 'http://localhost:5173' },
    { host: '[::1]:3001', origin: 'http://[::1]:5173' },
    { host: '100.78.133.28:3001', origin: 'http://100.78.133.28:5173' },
  ]) {
    assert.equal((await server.request(headers)).status, 202);
    assert.equal(await server.connect(headers), 101);
  }
  assert.equal((await server.request({ host: 'localhost' }, 'GET')).status, 200);
});

test('explicitly configured and wildcarded published domains keep their reverse-proxy compatibility', async (t) => {
  for (const allowedHosts of ['published.example', '*']) {
    await t.test(String(allowedHosts), async (context) => {
      const server = await fixture(context, allowedHosts);
      const headers = { host: 'published.example', origin: 'https://published.example', 'x-forwarded-proto': 'https' };
      assert.equal((await server.request(headers)).status, 202);
      assert.equal((await server.request({ host: 'published.example', 'x-forwarded-proto': 'https' }, 'GET')).status, 200);
      assert.equal(await server.connect(headers), 101);
    });
  }
});
