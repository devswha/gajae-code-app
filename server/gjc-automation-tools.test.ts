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
const FIRST_BINDING = { windowEpoch: 'window-1', documentEpoch: 7, origin: 'https://example.com' };

test('browser selector and fill budgets match native UTF-8 bounds before any bridge dispatch', async () => {
  const { browser } = createGjcAutomationTools('app-session', {
    async select() { assert.fail('invalid input must not reach approval'); },
  });
  for (const action of [
    { verb: 'click', selector: 'a'.repeat(4097) },
    { verb: 'click', selector: '가'.repeat(1400) },
    { verb: 'fill', selector: '#name', text: 'a'.repeat(65537) },
    { verb: 'fill', selector: '#name', text: '가'.repeat(22000) },
  ]) {
    await assert.rejects(browser!.execute('invalid-input', { action: 'act', actions: [action] }, undefined),
      (error: Error) => error.name === 'ZodError');
  }
});

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
        ? { granted: payload?.scope === 'session', origin: 'https://example.com', binding: FIRST_BINDING }
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
    assert.deepEqual(requests[2]?.payload, { url: 'https://example.com/page' });
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

async function bridgeServer(handle: (request: Record<string, unknown>) => { ok: boolean; result?: unknown; error?: string }) {
  const directory = await mkdtemp(join(tmpdir(), 'gajae-automation-chromium-'));
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
      socket.end(`${JSON.stringify({ id: request.id, ...handle(request) })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => resolve()); });
  return {
    socketPath,
    requests,
    close: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); },
  };
}

test('built-in browser exposes only selector-based WebView actions', async () => {
  const bridge = await bridgeServer(() => ({ ok: true, result: {} }));
  try {
    const { browser } = createGjcAutomationTools('app-session', {
      async select() { assert.fail('invalid parameters must fail before authorization'); },
    }, { socketPath: bridge.socketPath, token: TEST_TOKEN });
    for (const parameters of [
      { action: 'run', code: 'document.title' },
      { action: 'act', actions: [{ verb: 'screenshot' }] },
      { action: 'act', actions: [{ verb: 'select', selector: '#country', value: 'KR' }] },
      { action: 'act', actions: [{ verb: 'press', key: 'Enter' }] },
      { action: 'act', actions: [{ verb: 'scroll', dy: 100 }] },
      { action: 'act', actions: [{ verb: 'wait', ms: 10 }] },
      { action: 'act', actions: [{ verb: 'click', ref: 1 }] },
      { action: 'act', actions: [{ verb: 'fill', selector: '#name' }] },
      { action: 'act', actions: [] },
    ]) {
      await assert.rejects(browser!.execute('invalid-action', parameters, undefined));
    }
    assert.deepEqual(bridge.requests, []);
  } finally { await bridge.close(); }
});

test('built-in browser forwards the complete bounded action set with an expected binding', async () => {
  const bridge = await bridgeServer((request) => request.operation === 'authorize'
    ? { ok: true, result: { granted: true, origin: FIRST_BINDING.origin, binding: FIRST_BINDING } }
    : { ok: true, result: { acted: true } });
  const actions = [
    { verb: 'navigate', url: 'https://example.com/next' },
    { verb: 'back' },
    { verb: 'forward' },
    { verb: 'reload' },
    { verb: 'observe' },
    { verb: 'extract', selector: 'main', format: 'html' },
    { verb: 'click', selector: 'button[type="submit"]' },
    { verb: 'fill', selector: '#query', text: 'native WebView' },
  ];
  try {
    const { browser } = createGjcAutomationTools('app-session', {
      async select() { assert.fail('granted actions must not prompt'); },
    }, { socketPath: bridge.socketPath, token: TEST_TOKEN });
    await browser!.execute('all-actions', { action: 'act', actions }, undefined);

    const commands = bridge.requests.filter((request) => request.operation === 'command');
    assert.deepEqual(commands.map((request) => request.payload), actions.map(({ verb, ...parameters }) => ({
      command: { action: verb, ...parameters }, expected: FIRST_BINDING,
    })));
    const authorizations = bridge.requests.filter((request) => request.operation === 'authorize');
    assert.equal(authorizations.length, actions.length);
    assert.deepEqual(authorizations[0]!.payload, { url: 'https://example.com/next' });
    assert.deepEqual(authorizations.slice(1).map((request) => request.payload), Array(actions.length - 1).fill({}));
  } finally { await bridge.close(); }
});

test('browser command uses the original binding captured before permission UI', async () => {
  let authorizations = 0;
  const changedBinding = { windowEpoch: 'window-1', documentEpoch: 8, origin: 'https://elsewhere.example' };
  const bridge = await bridgeServer((request) => {
    if (request.operation === 'authorize') {
      authorizations += 1;
      return { ok: true, result: authorizations === 1
        ? { granted: false, origin: 'https://target.example', binding: FIRST_BINDING }
        : { granted: true, origin: 'https://target.example', binding: changedBinding } };
    }
    return { ok: true, result: { navigated: true } };
  });
  try {
    const { browser } = createGjcAutomationTools('app-session', {
      async select() { return 'Allow once'; },
    }, { socketPath: bridge.socketPath, token: TEST_TOKEN });
    await browser!.execute('navigate', {
      action: 'act', actions: [{ verb: 'navigate', url: 'https://target.example/path' }],
    }, undefined);

    assert.deepEqual(bridge.requests.map((request) => request.operation), ['authorize', 'authorize', 'command']);
    assert.deepEqual(bridge.requests[0]!.payload, { url: 'https://target.example/path' });
    assert.deepEqual(bridge.requests[2]!.payload, {
      command: { action: 'navigate', url: 'https://target.example/path' },
      expected: FIRST_BINDING,
    });
  } finally { await bridge.close(); }
});

test('browser act fails closed when authorization has no current page binding', async () => {
  const bridge = await bridgeServer((request) => request.operation === 'authorize'
    ? { ok: true, result: { granted: true, origin: null, binding: null } }
    : { ok: true, result: { acted: true } });
  try {
    const { browser } = createGjcAutomationTools('app-session', {
      async select() { assert.fail('a blank page has no origin prompt'); },
    }, { socketPath: bridge.socketPath, token: TEST_TOKEN });
    await assert.rejects(
      browser!.execute('observe', { action: 'act', actions: [{ verb: 'observe' }] }, undefined),
      /browser_state_unavailable/,
    );
    assert.deepEqual(bridge.requests.map((request) => request.operation), ['authorize']);
  } finally { await bridge.close(); }
});

test('bypass authorizes browser access for this session without an extra permission question', async () => {
  const bridge = await bridgeServer((request) => request.operation === 'authorize'
    ? { ok: true, result: { granted: (request.payload as Record<string, unknown>)?.scope === 'session', origin: 'https://example.com', binding: FIRST_BINDING } }
    : { ok: true, result: { opened: true } });
  let prompts = 0;
  try {
    const { browser } = createGjcAutomationTools('bypass-session', {
      async select() { prompts += 1; return 'Deny'; },
    }, { socketPath: bridge.socketPath, token: TEST_TOKEN }, 'bypass');
    await browser!.execute('bypass-open', { action: 'open', url: 'https://example.com/page' }, undefined);
    assert.equal(prompts, 0);
    assert.deepEqual(bridge.requests.map((request) => request.operation), ['authorize', 'open']);
    assert.ok(bridge.requests.every((request) => request.sessionId === 'bypass-session'));
    assert.ok(bridge.requests.every((request) => !(request.payload as Record<string, unknown> | undefined)?.scope));
  } finally { await bridge.close(); }
});

test('bypass covers computer access without creating session or persistent grants', async () => {
  const bridge = await bridgeServer((request) => request.operation === 'authorize'
    ? { ok: true, result: { granted: false, application: 'com.apple.TextEdit', label: 'TextEdit' } }
    : { ok: true, result: { controlled: true } });
  try {
    const { computer } = createGjcAutomationTools('bypass-computer', {
      async select() { assert.fail('bypass must not ask again'); },
    }, { socketPath: bridge.socketPath, token: TEST_TOKEN }, 'bypass');
    await computer!.execute('click', { action: 'click', arguments: { pid: 42, x: 10, y: 20 } }, undefined);
    assert.deepEqual(bridge.requests.map((request) => request.operation), ['authorize', undefined]);
    assert.ok(bridge.requests.every((request) => request.sessionId === 'bypass-computer'));
    assert.ok(bridge.requests.every((request) => !(request.payload as Record<string, unknown> | undefined)?.scope));
  } finally { await bridge.close(); }
});

test('bypass leaves later Ask runs and other sessions ungranted', async () => {
  let granted = false;
  const bridge = await bridgeServer((request) => {
    if ((request.payload as Record<string, unknown> | undefined)?.scope) granted = true;
    return { ok: true, result: request.operation === 'authorize' ? { granted, origin: 'https://example.com', binding: FIRST_BINDING } : { opened: true } };
  });
  let prompts = 0;
  const ui = { async select() { prompts += 1; return 'Deny'; } };
  try {
    const transport = { socketPath: bridge.socketPath, token: TEST_TOKEN };
    const bypass = createGjcAutomationTools('same-session', ui, transport, 'bypass');
    await bypass.browser!.execute('first', { action: 'open', url: 'https://example.com' }, undefined);
    await bypass.browser!.execute('again', { action: 'act', actions: [{ verb: 'observe' }] }, undefined);
    assert.equal(prompts, 0);
    assert.equal(granted, false);
    for (const sessionId of ['same-session', 'other-session']) {
      const ask = createGjcAutomationTools(sessionId, ui, transport, 'ask');
      await assert.rejects(ask.browser!.execute('ask', { action: 'open', url: 'https://example.com' }, undefined), /was denied/);
    }
    assert.equal(prompts, 2);
    assert.equal(granted, false);
  } finally { await bridge.close(); }
});

test('default and auto-edits modes still ask, and tool parameters cannot enable bypass', async () => {
  for (const mode of [undefined, 'ask', 'auto_edits'] as const) {
    const bridge = await bridgeServer(() => ({ ok: true, result: { granted: false, origin: 'https://example.com' } }));
    let prompts = 0;
    try {
      const { browser } = createGjcAutomationTools('ask-session', {
        async select() { prompts += 1; return 'Deny'; },
      }, { socketPath: bridge.socketPath, token: TEST_TOKEN }, mode);
      await assert.rejects(browser!.execute('untrusted-params', {
        action: 'open', url: 'https://example.com', permissionMode: 'bypass', permissions: { mode: 'bypass' },
      }, undefined), /unrecognized_keys/);
      assert.equal(prompts, 0);
      assert.equal(bridge.requests.length, 0);
      await assert.rejects(browser!.execute('valid-open', {
        action: 'open', url: 'https://example.com',
      }, undefined), /was denied/);
      assert.equal(prompts, 1);
      assert.deepEqual(bridge.requests.map((request) => request.operation), ['authorize']);
    } finally { await bridge.close(); }
  }
});

test('bypass preserves backend authorization failures', async () => {
  const rejected = await bridgeServer(() => ({ ok: false, error: 'Computer action requires a resolvable application identity.' }));
  try {
    const { computer } = createGjcAutomationTools('invalid-target', {
      async select() { assert.fail('must preserve the backend rejection'); },
    }, { socketPath: rejected.socketPath, token: TEST_TOKEN }, 'bypass');
    await assert.rejects(computer!.execute('bad-target', { action: 'click', arguments: { pid: 42 } }, undefined), /resolvable application/);
    assert.equal(rejected.requests.length, 1);
  } finally { await rejected.close(); }
});

test('already-cancelled bypass tools do not connect or authorize any action', async () => {
  const bridge = await bridgeServer(() => ({ ok: true, result: { granted: true } }));
  try {
    const tools = createGjcAutomationTools('cancelled-session', {
      async select() { assert.fail('cancelled calls must not ask'); },
    }, { socketPath: bridge.socketPath, token: TEST_TOKEN }, 'bypass');
    const signal = AbortSignal.abort();
    await assert.rejects(tools.browser!.execute('cancelled-browser', { action: 'open', url: 'https://example.com' }, signal), /cancelled/);
    await assert.rejects(tools.computer!.execute('cancelled-computer', { action: 'click', arguments: { pid: 42 } }, signal), /cancelled/);
    assert.deepEqual(bridge.requests, []);
  } finally { await bridge.close(); }
});
