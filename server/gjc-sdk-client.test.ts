import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { WebSocketServer, type WebSocket } from 'ws';

import { GjcSdkClientError, connectGjcSdkSession } from './gjc-sdk-client.js';

const SESSION_ID = 'session-123';
const TOKEN = 'endpoint-secret-token';

async function createDiscovery(url: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'gjc-sdk-client-'));
  const directory = path.join(cwd, '.gjc', 'state', 'sdk');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${SESSION_ID}.json`), JSON.stringify({
    url,
    token: TOKEN,
    sessionId: SESSION_ID,
    ...overrides,
  }));
  return cwd;
}

async function startServer(
  onConnection: (socket: WebSocket, requestUrl: string) => void,
  host = '127.0.0.1',
): Promise<WebSocketServer> {
  const server = new WebSocketServer({ host, port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  server.on('connection', (socket, request) => onConnection(socket, request.url ?? ''));
  return server;
}

function endpointFor(server: WebSocketServer): string {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const hostname = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return `ws://${hostname}:${address.port}`;
}

async function closeServer(server: WebSocketServer): Promise<void> {
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('connectGjcSdkSession authenticates and advertises controlled-ask support', async () => {
  let requestUrl = '';
  let clientHello: unknown;
  let clientHelloReceived!: () => void;
  const clientHelloPromise = new Promise<void>((resolve) => {
    clientHelloReceived = resolve;
  });
  const server = await startServer((socket, url) => {
    requestUrl = url;
    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 3 }));
    socket.once('message', (data) => {
      clientHello = JSON.parse(data.toString());
      clientHelloReceived();
    });
  });
  const cwd = await createDiscovery(endpointFor(server));
  try {
    const client = await connectGjcSdkSession({ cwd, sessionId: SESSION_ID });
    assert.ok(client);
    await clientHelloPromise;
    assert.equal(new URL(requestUrl, endpointFor(server)).searchParams.get('token'), TOKEN);
    assert.deepEqual(clientHello, {
      type: 'hello',
      protocolVersion: 3,
      capabilities: ['ask_controls_v1'],
    });
    await client.close();
  } finally {
    await closeServer(server);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('connectGjcSdkSession accepts numeric IPv6 loopback discovery', async () => {
  const cwd = await createDiscovery('ws://[::1]:0');
  try {
    await assert.rejects(
      connectGjcSdkSession({
        cwd,
        sessionId: SESSION_ID,
        discoveryTimeoutMs: 0,
        requestTimeoutMs: 100,
      }),
      (error: unknown) => error instanceof GjcSdkClientError && error.code === 'connection',
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('control and query use SDK v3 operation/input frames and correlate ids', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const server = await startServer((socket) => {
    socket.send(JSON.stringify({ type: 'server_hello', protocolVersion: 3 }));
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type === 'control_request') {
        requests.push(frame);
        socket.send(JSON.stringify({
          type: 'control_response',
          id: frame.id,
          ok: true,
          result: { aborted: true },
        }));
      }
      if (frame.type === 'query_request') {
        requests.push(frame);
        socket.send(JSON.stringify({
          type: 'query_response',
          id: frame.id,
          ok: true,
          page: { items: [{ state: 'idle' }], complete: true, revision: '1' },
        }));
      }
    });
  });
  const cwd = await createDiscovery(endpointFor(server));
  try {
    const client = await connectGjcSdkSession({ cwd, sessionId: SESSION_ID });
    assert.ok(client);
    assert.deepEqual(await client.control(
      'turn.abort',
      { reason: 'user' },
      { confirm: true, idempotencyKey: 'abort-request' },
    ), { aborted: true });
    assert.deepEqual(await client.query('context.get', {}, 'cursor-1'), {
      items: [{ state: 'idle' }],
      complete: true,
      revision: '1',
    });
    assert.equal(requests.length, 2);
    assert.deepEqual(
      {
        type: requests[0]?.type,
        operation: requests[0]?.operation,
        input: requests[0]?.input,
        confirm: requests[0]?.confirm,
        idempotencyKey: requests[0]?.idempotencyKey,
      },
      {
        type: 'control_request',
        operation: 'turn.abort',
        input: { reason: 'user' },
        confirm: true,
        idempotencyKey: 'abort-request',
      },
    );
    assert.deepEqual(
      {
        type: requests[1]?.type,
        query: requests[1]?.query,
        input: requests[1]?.input,
        cursor: requests[1]?.cursor,
      },
      { type: 'query_request', query: 'context.get', input: {}, cursor: 'cursor-1' },
    );
    assert.equal(typeof requests[0]?.id, 'string');
    assert.notEqual(requests[0]?.id, requests[1]?.id);
    await assert.rejects(
      client.control(''),
      (error: unknown) => error instanceof GjcSdkClientError && error.code === 'protocol',
    );
    await assert.rejects(
      client.query(''),
      (error: unknown) => error instanceof GjcSdkClientError && error.code === 'protocol',
    );
    assert.throws(
      () => client.reply('', {}),
      (error: unknown) => error instanceof GjcSdkClientError && error.code === 'protocol',
    );
    assert.equal(requests.length, 2);
    assert.equal('token' in requests[0]!, false);
    await client.close();
  } finally {
    await closeServer(server);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('mismatched SDK response kinds fail closed instead of settling requests', async () => {
  const server = await startServer((socket) => {
    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 3 }));
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type !== 'control_request') return;
      socket.send(JSON.stringify({
        type: 'query_response',
        id: frame.id,
        ok: true,
        result: { aborted: true },
      }));
    });
  });
  const cwd = await createDiscovery(endpointFor(server));
  try {
    const client = await connectGjcSdkSession({ cwd, sessionId: SESSION_ID });
    assert.ok(client);
    await assert.rejects(
      client.control('turn.abort'),
      (error: unknown) => error instanceof GjcSdkClientError && error.code === 'protocol',
    );
  } finally {
    await closeServer(server);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('reply uses the presentation id and token without exposing token to observers', async () => {
  let reply: Record<string, unknown> | undefined;
  let replyReceived!: () => void;
  const replyPromise = new Promise<void>((resolve) => {
    replyReceived = resolve;
  });
  const observed: Array<Record<string, unknown>> = [];
  const server = await startServer((socket) => {
    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 3 }));
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type === 'reply') {
        reply = frame;
        socket.send(JSON.stringify({
          type: 'diagnostic',
          value: TOKEN,
          [TOKEN]: 'sensitive-key-value',
        }));
        replyReceived();
      }
    });
  });
  const cwd = await createDiscovery(endpointFor(server));
  try {
    const client = await connectGjcSdkSession({ cwd, sessionId: SESSION_ID });
    assert.ok(client);
    client.onFrame(() => {
      throw new Error('observer failure');
    });
    client.onFrame((frame) => observed.push(frame));
    client.reply('ask-1', { selected: [0] });
    await replyPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(reply, {
      type: 'reply',
      id: 'ask-1',
      answer: { selected: [0] },
      token: TOKEN,
    });
    assert.deepEqual(observed.at(-1), {
      type: 'diagnostic',
      value: '[redacted]',
      '[redacted]': 'sensitive-key-value',
    });
    assert.equal(Object.values(client).includes(TOKEN), false);
    await client.close();
  } finally {
    await closeServer(server);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('connectGjcSdkSession rejects incompatible protocol versions', async () => {
  const server = await startServer((socket) => {
    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 2 }));
  });
  const cwd = await createDiscovery(endpointFor(server));
  try {
    await assert.rejects(
      connectGjcSdkSession({ cwd, sessionId: SESSION_ID, requestTimeoutMs: 100 }),
      (error: unknown) => error instanceof GjcSdkClientError && error.code === 'protocol',
    );
  } finally {
    await closeServer(server);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('connectGjcSdkSession rejects non-loopback and unsafe discovery', async () => {
  const cwd = await createDiscovery('ws://example.test:1234');
  try {
    assert.equal(
      await connectGjcSdkSession({ cwd, sessionId: SESSION_ID, discoveryTimeoutMs: 0 }),
      null,
    );
    await assert.rejects(
      connectGjcSdkSession({ cwd, sessionId: '../escape', discoveryTimeoutMs: 0 }),
      (error: unknown) => error instanceof GjcSdkClientError && error.code === 'discovery',
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('connectGjcSdkSession rejects discovery URLs with credentials, query, or fragments', async () => {
  for (const url of [
    'ws://user@127.0.0.1:1234',
    'ws://127.0.0.1:1234?token=untrusted',
    'ws://127.0.0.1:1234/#fragment',
    'wss://127.0.0.1:1234',
    'ws://localhost:1234',
  ]) {
    const cwd = await createDiscovery(url);
    try {
      assert.equal(
        await connectGjcSdkSession({ cwd, sessionId: SESSION_ID, discoveryTimeoutMs: 0 }),
        null,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
});

test('connectGjcSdkSession returns null when discovery is missing', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'gjc-sdk-client-'));
  try {
    assert.equal(
      await connectGjcSdkSession({ cwd, sessionId: SESSION_ID, discoveryTimeoutMs: 0 }),
      null,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
test('connectGjcSdkSession rejects invalid timeout configuration before discovery', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'gjc-sdk-client-'));
  try {
    for (const options of [
      { discoveryTimeoutMs: -1 },
      { discoveryTimeoutMs: Number.NaN },
      { requestTimeoutMs: 0 },
      { requestTimeoutMs: Number.POSITIVE_INFINITY },
    ]) {
      await assert.rejects(
        connectGjcSdkSession({ cwd, sessionId: SESSION_ID, ...options }),
        (error: unknown) => error instanceof GjcSdkClientError && error.code === 'discovery',
      );
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('timed out SDK requests are removed without poisoning later requests', async () => {
  const server = await startServer((socket) => {
    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 3 }));
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type !== 'query_request') return;
      socket.send(JSON.stringify({
        type: 'query_response',
        id: frame.id,
        ok: true,
        page: { items: [{ state: 'ready' }] },
      }));
    });
  });
  const cwd = await createDiscovery(endpointFor(server));
  try {
    const client = await connectGjcSdkSession({
      cwd,
      sessionId: SESSION_ID,
      requestTimeoutMs: 50,
    });
    assert.ok(client);
    await assert.rejects(
      client.control('turn.abort'),
      (error: unknown) => (
        error instanceof GjcSdkClientError
        && error.code === 'timeout'
        && !error.message.includes(TOKEN)
      ),
    );
    assert.deepEqual(await client.query('context.get'), {
      items: [{ state: 'ready' }],
    });
    await client.close();
  } finally {
    await closeServer(server);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('invalid post-handshake frames fail closed and reject pending requests', async () => {
  const observed: Array<Record<string, unknown>> = [];
  const server = await startServer((socket) => {
    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 3 }));
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type === 'control_request') socket.send('{invalid-json');
    });
  });
  const cwd = await createDiscovery(endpointFor(server));
  try {
    const client = await connectGjcSdkSession({
      cwd,
      sessionId: SESSION_ID,
      requestTimeoutMs: 1_000,
    });
    assert.ok(client);
    client.onFrame((frame) => observed.push(frame));
    await assert.rejects(
      client.control('turn.abort'),
      (error: unknown) => error instanceof GjcSdkClientError && error.code === 'protocol',
    );
    assert.deepEqual(
      observed.filter((frame) => frame.type === 'transport_closed'),
      [{ type: 'transport_closed', reason: 'protocol' }],
    );
  } finally {
    await closeServer(server);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a connection close rejects pending SDK requests', async () => {
  const server = await startServer((socket) => {
    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 3 }));
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as { type: string };
      if (frame.type === 'control_request') socket.close();
    });
  });
  const cwd = await createDiscovery(endpointFor(server));
  try {
    const client = await connectGjcSdkSession({
      cwd,
      sessionId: SESSION_ID,
      requestTimeoutMs: 1_000,
    });
    assert.ok(client);
    await assert.rejects(
      client.control('turn.abort'),
      (error: unknown) => error instanceof GjcSdkClientError && error.code === 'closed',
    );
  } finally {
    await closeServer(server);
    await rm(cwd, { recursive: true, force: true });
  }
});

test('remote SDK errors redact endpoint tokens from exceptions and observers', async () => {
  const observed: Array<Record<string, unknown>> = [];
  const server = await startServer((socket) => {
    socket.send(JSON.stringify({ type: 'hello', protocolVersion: 3 }));
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      if (frame.type !== 'control_request') return;
      socket.send(JSON.stringify({
        type: 'control_response',
        id: frame.id,
        ok: false,
        error: { code: 'failed', message: `credential ${TOKEN} rejected` },
      }));
    });
  });
  const cwd = await createDiscovery(endpointFor(server));
  try {
    const client = await connectGjcSdkSession({ cwd, sessionId: SESSION_ID });
    assert.ok(client);
    client.onFrame((frame) => observed.push(frame));
    await assert.rejects(
      client.control('turn.abort'),
      (error: unknown) => (
        error instanceof GjcSdkClientError
        && error.message === 'credential [redacted] rejected'
      ),
    );
    assert.equal(JSON.stringify(observed).includes(TOKEN), false);
    await client.close();
  } finally {
    await closeServer(server);
    await rm(cwd, { recursive: true, force: true });
  }
});
