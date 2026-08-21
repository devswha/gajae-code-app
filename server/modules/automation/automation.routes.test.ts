import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import express, { type Router } from 'express';

import type { AutomationService } from './automation.service.js';
import { createAutomationRouter, createBrowserAutomationRouter } from './automation.routes.js';

type RecordedCall = { method: string; sessionId?: string; payload?: unknown };

function fakeService(calls: RecordedCall[]): AutomationService {
  const grants: Array<Record<string, unknown>> = [];
  return {
    status: async () => ({ supported: true, browser: { state: 'ready' }, cua: { installed: true } }),
    openBrowser: async (sessionId: string, payload: unknown) => {
      calls.push({ method: 'open', sessionId, payload });
      return { sessionId, activeTabId: 'tab-1', tabs: [] };
    },
    commandBrowser: async (sessionId: string, payload: unknown) => {
      calls.push({ method: 'command', sessionId, payload });
      return { ok: true };
    },
    inputBrowser: async (sessionId: string, payload: unknown) => {
      calls.push({ method: 'input', sessionId, payload });
      return { accepted: true };
    },
    stopSession: async (sessionId: string) => {
      calls.push({ method: 'close', sessionId });
      return { closed: true };
    },
    callComputer: async (sessionId: string, tool: string, payload: unknown) => {
      calls.push({ method: `computer:${tool}`, sessionId, payload });
      return { content: [{ type: 'text', text: 'fake CUA result' }] };
    },
    grant: (grant: Record<string, unknown>) => {
      grants.push(grant);
      calls.push({ method: 'grant', payload: grant });
    },
    grants: {
      list: () => grants,
      revoke: (filter: Record<string, unknown>) => {
        calls.push({ method: 'revoke', payload: filter });
        grants.length = 0;
      },
    },
  } as unknown as AutomationService;
}

async function serve(router: Router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Automation route test server did not bind.');
  return {
    request: (path: string, options?: RequestInit) => fetch(`http://127.0.0.1:${address.port}${path}`, options),
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('the public browser API forwards open, command, input, and stop to one shared session', async () => {
  const calls: RecordedCall[] = [];
  const server = await serve(createBrowserAutomationRouter(fakeService(calls)));
  try {
    assert.equal((await server.request('/qa-session/open', json({ url: 'https://example.test', allowDownload: false }))).status, 200);
    assert.equal((await server.request('/qa-session/command', json({ command: { action: 'observe' } }))).status, 200);
    assert.equal((await server.request('/qa-session/input', json({ input: { kind: 'text', text: 'hello' } }))).status, 200);
    assert.equal((await server.request('/qa-session', { method: 'DELETE' })).status, 200);
    assert.deepEqual(calls, [
      { method: 'open', sessionId: 'qa-session', payload: { url: 'https://example.test', allowDownload: false } },
      { method: 'command', sessionId: 'qa-session', payload: { action: 'observe' } },
      { method: 'input', sessionId: 'qa-session', payload: { kind: 'text', text: 'hello' } },
      { method: 'close', sessionId: 'qa-session' },
    ]);
  } finally {
    await server.close();
  }
});

test('automation routes exercise a fake CUA backend and persistent grant revoke flow', async () => {
  const calls: RecordedCall[] = [];
  const server = await serve(createAutomationRouter(fakeService(calls)));
  try {
    const call = await server.request('/computer/qa-session/call', json({ tool: 'list_apps', arguments: {} }));
    assert.equal(call.status, 200);
    assert.deepEqual(await call.json(), { content: [{ type: 'text', text: 'fake CUA result' }] });

    const granted = await server.request('/grants', json({
      kind: 'application',
      value: 'com.apple.TextEdit',
      scope: 'always',
    }));
    assert.equal(granted.status, 200);
    assert.equal((await granted.json()).length, 1);

    const revoked = await server.request('/grants', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'application', value: 'com.apple.TextEdit' }),
    });
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), []);
    assert.deepEqual(calls, [
      { method: 'computer:list_apps', sessionId: 'qa-session', payload: {} },
      { method: 'grant', payload: { kind: 'application', value: 'com.apple.TextEdit', scope: 'always' } },
      { method: 'revoke', payload: { kind: 'application', value: 'com.apple.TextEdit' } },
    ]);
  } finally {
    await server.close();
  }
});
