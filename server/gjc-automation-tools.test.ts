import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createGjcAutomationTools,
  takeGjcAutomationBridgeTransport,
} from './gjc-automation-tools.js';

const TEST_TOKEN = 'a'.repeat(64);

test('automation bridge capability is captured once and removed from the worker environment', () => {
  const environment: NodeJS.ProcessEnv = {
    GJC_AUTOMATION_SOCKET: '/tmp/gajae-test.sock',
    GJC_AUTOMATION_TOKEN: TEST_TOKEN,
  };
  assert.deepEqual(takeGjcAutomationBridgeTransport(environment), {
    socketPath: '/tmp/gajae-test.sock',
    token: TEST_TOKEN,
  });
  assert.equal(environment.GJC_AUTOMATION_SOCKET, undefined);
  assert.equal(environment.GJC_AUTOMATION_TOKEN, undefined);
  assert.equal(takeGjcAutomationBridgeTransport(environment), undefined);
});

test('agent browser asks for origin access before opening and records allow once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae-automation-tools-'));
  const socketPath = join(directory, 'bridge.sock');
  const requests: Array<Record<string, unknown>> = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      requests.push(request);
      const payload = request.payload as Record<string, unknown> | undefined;
      const result = request.operation === 'authorize'
        ? { granted: payload?.scope === 'session', origin: 'https://example.com' }
        : { sessionId: 'app-session', activeTabId: 'tab-1', tabs: [] };
      socket.end(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  const prompts: Array<{ title: string; options: string[] }> = [];
  try {
    const { browser } = createGjcAutomationTools('app-session', {
      async select(title, options) {
        prompts.push({ title, options });
        return 'Allow once';
      },
    }, { socketPath, token: TEST_TOKEN });
    assert.ok(browser);
    await browser.execute(
      'tool-call-1',
      { action: 'open', url: 'https://example.com/page' },
      undefined,
    );

    assert.deepEqual(prompts, [{
      title: 'Allow the agent to use https://example.com?',
      options: ['Allow once', 'Always allow', 'Deny'],
    }]);
    assert.deepEqual(requests.map((request) => request.operation), ['authorize', 'authorize', 'open']);
    assert.equal((requests[1]?.payload as Record<string, unknown>).scope, 'session');
    assert.equal((requests[2]?.payload as Record<string, unknown>).allowDownload, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('agent browser denial fails closed without opening the requested origin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae-automation-deny-'));
  const socketPath = join(directory, 'bridge.sock');
  const requests: Array<Record<string, unknown>> = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      requests.push(request);
      socket.end(`${JSON.stringify({
        id: request.id,
        ok: true,
        result: { granted: false, origin: 'https://denied.example' },
      })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  try {
    const { browser } = createGjcAutomationTools('app-session', {
      async select() { return 'Deny'; },
    }, { socketPath, token: TEST_TOKEN });
    assert.ok(browser);
    await assert.rejects(
      browser.execute(
        'tool-call-denied',
        { action: 'open', url: 'https://denied.example/private' },
        undefined,
      ),
      /access .* was denied/iu,
    );
    assert.deepEqual(requests.map((request) => request.operation), ['authorize']);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('agent browser forwards the standard AgentTool abort signal to the bridge request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae-automation-abort-'));
  const socketPath = join(directory, 'bridge.sock');
  let requestReceived!: () => void;
  const received = new Promise<void>((resolve) => { requestReceived = resolve; });
  const server = net.createServer((socket) => {
    socket.once('data', () => requestReceived());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  try {
    const { browser } = createGjcAutomationTools('app-session', {
      async select() { return 'Deny'; },
    }, { socketPath, token: TEST_TOKEN });
    assert.ok(browser);
    const controller = new AbortController();
    const execution = browser.execute('tool-call-abort', { action: 'close' }, controller.signal);
    await received;
    controller.abort();
    await assert.rejects(execution, /cancelled/iu);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('agent computer asks for application access before controlling it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae-computer-tools-'));
  const socketPath = join(directory, 'bridge.sock');
  const requests: Array<Record<string, unknown>> = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      requests.push(request);
      const payload = request.payload as Record<string, unknown> | undefined;
      const result = request.operation === 'authorize'
        ? { granted: payload?.scope === 'session', application: 'com.apple.TextEdit', label: 'TextEdit' }
        : { effect: 'confirmed' };
      socket.end(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  const prompts: Array<{ title: string; options: string[] }> = [];
  try {
    const { computer } = createGjcAutomationTools('app-session', {
      async select(title, options) {
        prompts.push({ title, options });
        return 'Allow once';
      },
    }, { socketPath, token: TEST_TOKEN });
    assert.ok(computer);
    await computer.execute(
      'tool-call-2',
      { action: 'click', arguments: { pid: 42, x: 10, y: 10 } },
      undefined,
    );

    assert.deepEqual(prompts, [{
      title: 'Allow the agent to control TextEdit?',
      options: ['Allow once', 'Always allow', 'Deny'],
    }]);
    assert.deepEqual(requests.map((request) => request.operation), ['authorize', 'authorize', undefined]);
    assert.equal((requests[1]?.payload as Record<string, unknown>).scope, 'session');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('agent computer preserves MCP image and text blocks without duplicating large output in details', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae-computer-output-'));
  const socketPath = join(directory, 'bridge.sock');
  const imageData = 'a'.repeat(260_000);
  const treeMarkdown = 'tree'.repeat(20_000);
  const elements = Array.from({ length: 200 }, (_, index) => ({ index, label: `element-${index}` }));
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      const result = request.operation === 'authorize'
        ? { granted: true, application: 'com.apple.TextEdit', label: 'TextEdit' }
        : {
            content: [
              { type: 'image', data: imageData, mimeType: 'image/png' },
              { type: 'text', text: 'window_id=7 pid=42\n- [0] AXWindow "README.md"' },
            ],
            structuredContent: {
              window_id: 7,
              window_bounds: { x: 10, y: 20, width: 640, height: 480 },
              elements,
              tree_markdown: treeMarkdown,
            },
          };
      socket.end(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  try {
    const { computer } = createGjcAutomationTools('app-session', {
      async select() { return 'Allow once'; },
    }, { socketPath, token: TEST_TOKEN });
    assert.ok(computer);
    const result = await computer.execute(
      'tool-call-large-output',
      { action: 'get_window_state', arguments: { pid: 42, window_id: 7 } },
      undefined,
    ) as { content: Array<Record<string, unknown>>; details: Record<string, unknown> };

    assert.equal(result.content[0]?.type, 'image');
    assert.equal(result.content[0]?.data, imageData);
    assert.match(String(result.content[1]?.text), /AXWindow/);
    assert.match(String(result.content[2]?.text), /"window_bounds"/u);
    assert.match(String(result.content[2]?.text), /"width": 640/u);
    assert.equal(result.details.window_id, 7);
    assert.equal('elements' in result.details, false);
    assert.equal('tree_markdown' in result.details, false);
    assert.deepEqual(result.details.omitted, {
      elements: 200,
      treeMarkdownChars: treeMarkdown.length,
      reason: 'Large accessibility payload is available to the model through the tool content and was omitted from UI details.',
    });
    assert.ok(JSON.stringify(result.details).length < 2_000);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('agent computer exposes compact structured metadata even when the original payload is small', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae-computer-metadata-'));
  const socketPath = join(directory, 'bridge.sock');
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>;
      const result = request.operation === 'authorize'
        ? { granted: true, application: 'com.apple.TextEdit', label: 'TextEdit' }
        : {
            content: [{ type: 'text', text: 'window_id=7 pid=42 size=640x480' }],
            structuredContent: {
              window_id: 7,
              window_bounds: { x: 10, y: 20, width: 640, height: 480 },
              elements: [{ index: 0, label: 'README.md' }],
              tree_markdown: '- [0] AXWindow "README.md"',
            },
          };
      socket.end(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  try {
    const { computer } = createGjcAutomationTools('app-session', {
      async select() { return 'Allow once'; },
    }, { socketPath, token: TEST_TOKEN });
    assert.ok(computer);
    const result = await computer.execute(
      'tool-call-small-output',
      { action: 'get_window_state', arguments: { pid: 42, window_id: 7 } },
      undefined,
    ) as { content: Array<Record<string, unknown>>; details: Record<string, unknown> };

    assert.match(String(result.content[1]?.text), /"x": 10/u);
    assert.match(String(result.content[1]?.text), /"height": 480/u);
    assert.equal('elements' in result.details, false);
    assert.equal('tree_markdown' in result.details, false);
    assert.deepEqual(result.details.omitted, {
      elements: 1,
      treeMarkdownChars: 26,
      reason: 'Large accessibility payload is available to the model through the tool content and was omitted from UI details.',
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
