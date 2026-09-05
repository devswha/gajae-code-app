import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AutomationGrantStore } from './automation-grants.js';
import { AutomationService, automationSupport } from './automation.service.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
  };
}

test('Linux desktop enables the browser without widening native computer support', () => {
  assert.deepEqual(automationSupport('linux', 'x64', { GJC_DESKTOP: '1' }), { browser: true, computer: false });
  assert.deepEqual(automationSupport('darwin', 'arm64', { GJC_DESKTOP: '1' }), { browser: true, computer: true });
  for (const [platform, arch] of [['linux', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']] as const) {
    assert.deepEqual(automationSupport(platform, arch, { GJC_DESKTOP: '1' }), { browser: false, computer: false });
  }
  assert.deepEqual(automationSupport('linux', 'x64', {}), { browser: false, computer: false });
  assert.deepEqual(automationSupport('linux', 'x64', { GAJAE_AUTOMATION: '1' }), { browser: true, computer: true });
});

test('Linux desktop status and browser calls work without inspecting or calling CUA', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async () => {
  const previous = { GJC_DESKTOP: process.env.GJC_DESKTOP, GAJAE_AUTOMATION: process.env.GAJAE_AUTOMATION };
  process.env.GJC_DESKTOP = '1';
  delete process.env.GAJAE_AUTOMATION;
  try {
    const service = new AutomationService();
    service.cua.status = async () => { throw new Error('Linux browser must not inspect CUA'); };
    service.cua.call = async () => { throw new Error('Linux browser must not call CUA'); };
    service.browser.status = async () => ({ state: 'idle', installed: false, buildId: 'fixture' });
    service.browser.open = async (sessionId, payload) => ({ sessionId, url: payload.url });
    const status = await service.status();
    assert.equal(status.supported, true);
    assert.equal(status.computerSupported, false);
    assert.deepEqual(await service.openBrowser('linux-session', { url: 'http://localhost:5173' }), { sessionId: 'linux-session', url: 'http://localhost:5173' });
    await assert.rejects(service.callComputer('linux-session', 'list_apps', {}), /Native computer automation is not enabled/);
    await assert.rejects(service.authorizeComputer('linux-session', { tool: 'list_apps' }), /Native computer automation is not enabled/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('shutdown of an unstarted service preserves an existing configured socket path and another bridge environment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae-bridge-owner-'));
  const socket = join(directory, 'automation.sock');
  await writeFile(socket, 'owned by another instance');
  const previous = { GAJAE_AUTOMATION_SOCKET: process.env.GAJAE_AUTOMATION_SOCKET, GJC_AUTOMATION_SOCKET: process.env.GJC_AUTOMATION_SOCKET, GJC_AUTOMATION_TOKEN: process.env.GJC_AUTOMATION_TOKEN };
  Object.assign(process.env, { GAJAE_AUTOMATION_SOCKET: socket, GJC_AUTOMATION_SOCKET: socket, GJC_AUTOMATION_TOKEN: 'another-bridge' });
  try {
    await new AutomationService().shutdown();
    assert.equal(await readFile(socket, 'utf8'), 'owned by another instance');
    assert.equal(process.env.GJC_AUTOMATION_TOKEN, 'another-bridge');
    assert.equal(process.env.GJC_AUTOMATION_SOCKET, socket);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('starting on an occupied Unix socket fails without disconnecting its existing owner', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae-bridge-in-use-'));
  const socket = join(directory, 'automation.sock');
  const owner = net.createServer(client => client.end('existing owner'));
  owner.listen(socket);
  await once(owner, 'listening');
  const previous = { GAJAE_AUTOMATION: process.env.GAJAE_AUTOMATION, GAJAE_AUTOMATION_SOCKET: process.env.GAJAE_AUTOMATION_SOCKET };
  Object.assign(process.env, { GAJAE_AUTOMATION: '1', GAJAE_AUTOMATION_SOCKET: socket });
  try {
    const service = new AutomationService();
    await assert.rejects(service.startBridge(), { code: 'EADDRINUSE' });
    await service.shutdown();
    const client = net.createConnection(socket);
    const [data] = await once(client, 'data');
    assert.equal(data.toString(), 'existing owner');
    client.destroy();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise<void>(resolve => owner.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('shutdown closes idle automation clients instead of waiting forever for them', { skip: process.platform === 'win32', timeout: 2000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gajae-bridge-idle-'));
  const socket = join(directory, 'automation.sock');
  const previous = { GAJAE_AUTOMATION: process.env.GAJAE_AUTOMATION, GAJAE_AUTOMATION_SOCKET: process.env.GAJAE_AUTOMATION_SOCKET };
  Object.assign(process.env, { GAJAE_AUTOMATION: '1', GAJAE_AUTOMATION_SOCKET: socket });
  const service = new AutomationService();
  let client: net.Socket | undefined;
  try {
    await service.startBridge();
    client = net.createConnection(socket);
    await once(client, 'connect');
    const closed = once(client, 'close');
    await service.shutdown();
    await closed;
    await assert.rejects(readFile(socket), { code: 'ENOENT' });
  } finally {
    client?.destroy();
    await service.shutdown();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

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

test('a sidecar browser window resolves to the Workspace Browser identity', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });
    Object.defineProperty(service.browser, 'browserPid', { value: 64876 });
    // The pid is already known to be the app-owned sidecar; consulting the CUA
    // inventory would be wasted work and cannot resolve it anyway.
    service.cua.call = async () => { throw new Error('inventory must not be consulted'); };

    assert.deepEqual(
      await service.authorizeComputer('session-a', { tool: 'click', arguments: { pid: 64876, window_id: 18462 } }),
      { granted: false, application: 'app.gajae.workspace-browser', label: 'Workspace Browser' },
    );
    assert.deepEqual(
      await service.authorizeComputer('session-a', { tool: 'click', arguments: { pid: 64876 }, scope: 'session' }),
      { granted: true, application: 'app.gajae.workspace-browser', label: 'Workspace Browser' },
    );
  } finally {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  }
});

test('a window id owned by the sidecar browser resolves through the window inventory', async () => {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  try {
    const service = new AutomationService();
    Object.defineProperty(service, 'grants', { value: new AutomationGrantStore(memoryStorage()) });
    Object.defineProperty(service.browser, 'browserPid', { value: 64876 });
    service.cua.call = async (tool) => {
      assert.equal(tool, 'list_windows');
      // Chrome for Testing runs outside any app bundle: the window is listed
      // but no application record matches its pid.
      return {
        structuredContent: {
          apps: [{ pid: 42, bundle_id: 'com.apple.TextEdit', name: 'TextEdit' }],
          windows: [{ pid: 64876, window_id: 18462, title: 'Todo List' }],
        },
      };
    };

    assert.deepEqual(
      await service.authorizeComputer('session-a', { tool: 'click', arguments: { window_id: 18462 } }),
      { granted: false, application: 'app.gajae.workspace-browser', label: 'Workspace Browser' },
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
