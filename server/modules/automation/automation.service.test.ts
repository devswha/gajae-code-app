import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';

import { AutomationGrantStore } from './automation-grants.js';
import { AutomationService } from './automation.service.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
  };
}

test('browser authorization is origin-scoped and can persist for one session', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });

    assert.deepEqual(
      await service.authorizeBrowser('session-a', { url: 'https://example.com/private?q=1' }),
      { granted: false, origin: 'https://example.com' },
    );
    assert.deepEqual(
      await service.authorizeBrowser('session-a', { url: 'https://example.com/other', scope: 'session' }),
      { granted: true, origin: 'https://example.com' },
    );
    assert.equal(
      (await service.authorizeBrowser('session-b', { url: 'https://example.com' })).granted,
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});

test('browser authorization resolves the active tab when a tool action has no URL', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });
    service.browser.state = async () => ({
      sessionId: 'session-a',
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', title: 'Docs', url: 'https://docs.example.test/guide', loading: false, canGoBack: false, canGoForward: false }],
    });

    assert.deepEqual(
      await service.authorizeBrowser('session-a', {}),
      { granted: false, origin: 'https://docs.example.test' },
    );
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});

test('computer authorization resolves a pid to a bundle identity and scopes the grant', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });
    service.cua.call = async (tool) => {
      assert.equal(tool, 'list_apps');
      return {
        structuredContent: {
          apps: [{ pid: 42, bundle_id: 'com.apple.TextEdit', name: 'TextEdit' }],
        },
      };
    };

    assert.deepEqual(
      await service.authorizeComputer('session-a', { tool: 'click', arguments: { pid: 42 } }),
      { granted: false, application: 'com.apple.TextEdit', label: 'TextEdit' },
    );
    assert.deepEqual(
      await service.authorizeComputer('session-a', { tool: 'click', arguments: { pid: 42 }, scope: 'session' }),
      { granted: true, application: 'com.apple.TextEdit', label: 'TextEdit' },
    );
    assert.equal(
      (await service.authorizeComputer('session-b', { tool: 'click', arguments: { pid: 42 } })).granted,
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});

test('computer authorization resolves a window id to its owning application', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });
    service.cua.call = async (tool) => {
      assert.equal(tool, 'list_windows');
      return {
        structuredContent: {
          apps: [{ pid: 42, bundle_id: 'com.apple.TextEdit', name: 'TextEdit' }],
          windows: [{ pid: 42, window_id: 14747, title: 'README.md' }],
        },
      };
    };

    assert.deepEqual(
      await service.authorizeComputer('session-a', {
        tool: 'get_window_state',
        arguments: { window_id: 14747, include_screenshot: false },
      }),
      { granted: false, application: 'com.apple.TextEdit', label: 'TextEdit' },
    );
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});

test('computer discovery does not require an application grant', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });
    assert.deepEqual(
      await service.authorizeComputer('session-a', { tool: 'list_apps', arguments: {} }),
      { granted: true, application: null, label: null },
    );
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});

test('stopping a session closes browser and CUA work and revokes only session grants', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    const grants = new AutomationGrantStore(memoryStorage());
    Object.defineProperty(service, 'grants', { value: grants });
    grants.grant({ kind: 'origin', value: 'https://session.example', scope: 'session', sessionId: 'session-a' });
    grants.grant({ kind: 'application', value: 'com.example.Persistent', scope: 'always' });

    const calls: string[] = [];
    let cuaLabel = '';
    service.browser.close = async (sessionId, signal) => {
      assert.equal(sessionId, 'session-a');
      assert.equal(signal?.aborted, false);
      calls.push('browser.close');
      return { closed: true };
    };
    service.cua.call = async (tool, args, signal) => {
      if (tool === 'start_session') {
        cuaLabel = String(args.session);
        assert.match(cuaLabel, /^gajae-/u);
        return { ok: true };
      }
      if (tool === 'list_apps') {
        assert.equal(args.session, cuaLabel);
        return { apps: [] };
      }
      assert.equal(tool, 'end_session');
      assert.deepEqual(args, { session: cuaLabel });
      assert.equal(signal?.aborted, false);
      calls.push('cua.end_session');
      return { ok: true };
    };

    await service.callComputer('session-a', 'list_apps', {});

    assert.deepEqual(await service.stopSession('session-a'), { closed: true });
    assert.deepEqual(calls.sort(), ['browser.close', 'cua.end_session']);
    assert.deepEqual(grants.list('session-a').session, []);
    assert.deepEqual(grants.list().always.applications, ['com.example.Persistent']);
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});

test('disconnecting an automation bridge client cancels its in-flight CUA request', async () => {
  const previousAutomation = process.env.GAJAE_AUTOMATION;
  const previousSocket = process.env.GJC_AUTOMATION_SOCKET;
  const previousToken = process.env.GJC_AUTOMATION_TOKEN;
  process.env.GAJAE_AUTOMATION = '1';
  const service = new AutomationService();
  try {
    let markStarted!: () => void;
    let markAborted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const aborted = new Promise<void>((resolve) => { markAborted = resolve; });
    let cuaLabel = '';
    service.cua.call = async (tool, args, signal) => {
      if (tool === 'start_session') {
        cuaLabel = String(args.session);
        assert.match(cuaLabel, /^gajae-/u);
        return { ok: true };
      }
      if (tool === 'end_session') {
        assert.deepEqual(args, { session: cuaLabel });
        return { ok: true };
      }
      assert.equal(tool, 'list_apps');
      assert.deepEqual(args, { session: cuaLabel });
      assert.ok(signal);
      markStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          markAborted();
          reject(new Error('cancelled'));
        }, { once: true });
      });
    };

    await service.startBridge();
    const socketPath = process.env.GJC_AUTOMATION_SOCKET;
    const token = process.env.GJC_AUTOMATION_TOKEN;
    assert.ok(socketPath);
    assert.ok(token);
    const socket = net.createConnection(socketPath);
    await once(socket, 'connect');
    socket.write(`${JSON.stringify({
      id: 'disconnect-request',
      token,
      surface: 'computer',
      sessionId: 'session-a',
      tool: 'list_apps',
      arguments: {},
    })}\n`);
    await started;
    socket.destroy();
    await aborted;
  } finally {
    await service.shutdown();
    if (previousAutomation === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previousAutomation;
    if (previousSocket === undefined) delete process.env.GJC_AUTOMATION_SOCKET;
    else process.env.GJC_AUTOMATION_SOCKET = previousSocket;
    if (previousToken === undefined) delete process.env.GJC_AUTOMATION_TOKEN;
    else process.env.GJC_AUTOMATION_TOKEN = previousToken;
  }
});
