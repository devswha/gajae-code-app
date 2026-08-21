import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createGjcAutomationTools } from './gjc-automation-tools.js';

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

  const previousSocket = process.env.GJC_AUTOMATION_SOCKET;
  const previousToken = process.env.GJC_AUTOMATION_TOKEN;
  process.env.GJC_AUTOMATION_SOCKET = socketPath;
  process.env.GJC_AUTOMATION_TOKEN = 'test-token';
  const prompts: Array<{ title: string; options: string[] }> = [];
  try {
    const [browser] = createGjcAutomationTools('app-session', {
      async select(title, options) {
        prompts.push({ title, options });
        return 'Allow once';
      },
    });
    assert.ok(browser);
    await browser.execute(
      'tool-call-1',
      { action: 'open', url: 'https://example.com/page' },
      undefined,
      {} as never,
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
    if (previousSocket === undefined) delete process.env.GJC_AUTOMATION_SOCKET;
    else process.env.GJC_AUTOMATION_SOCKET = previousSocket;
    if (previousToken === undefined) delete process.env.GJC_AUTOMATION_TOKEN;
    else process.env.GJC_AUTOMATION_TOKEN = previousToken;
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

  const previousSocket = process.env.GJC_AUTOMATION_SOCKET;
  const previousToken = process.env.GJC_AUTOMATION_TOKEN;
  process.env.GJC_AUTOMATION_SOCKET = socketPath;
  process.env.GJC_AUTOMATION_TOKEN = 'test-token';
  const prompts: Array<{ title: string; options: string[] }> = [];
  try {
    const [, computer] = createGjcAutomationTools('app-session', {
      async select(title, options) {
        prompts.push({ title, options });
        return 'Allow once';
      },
    });
    assert.ok(computer);
    await computer.execute(
      'tool-call-2',
      { action: 'click', arguments: { pid: 42, x: 10, y: 10 } },
      undefined,
      {} as never,
      undefined,
    );

    assert.deepEqual(prompts, [{
      title: 'Allow the agent to control TextEdit?',
      options: ['Allow once', 'Always allow', 'Deny'],
    }]);
    assert.deepEqual(requests.map((request) => request.operation), ['authorize', 'authorize', undefined]);
    assert.equal((requests[1]?.payload as Record<string, unknown>).scope, 'session');
  } finally {
    if (previousSocket === undefined) delete process.env.GJC_AUTOMATION_SOCKET;
    else process.env.GJC_AUTOMATION_SOCKET = previousSocket;
    if (previousToken === undefined) delete process.env.GJC_AUTOMATION_TOKEN;
    else process.env.GJC_AUTOMATION_TOKEN = previousToken;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
