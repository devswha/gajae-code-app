import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { AutomationGrantStore } from './automation-grants.js';
import { AutomationService } from './automation.service.js';
import { CuaDriverClient } from './cua-client.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
  };
}

/** TextEdit-shaped inventory so pid 42 resolves to a stable bundle identity. */
const INVENTORY = {
  structuredContent: {
    apps: [{ pid: 42, bundle_id: 'com.apple.TextEdit', name: 'TextEdit' }],
    windows: [{ pid: 42, window_id: 7, title: 'README.md' }],
  },
};

type Dispatched = { tool: string; args: Record<string, unknown> };

/**
 * A service whose driver transport is replaced by a recorder. Everything above
 * the transport — identity resolution, grant enforcement, session labels — is
 * the real implementation.
 */
function service(t: TestContext) {
  const previous = process.env.GAJAE_AUTOMATION;
  process.env.GAJAE_AUTOMATION = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.GAJAE_AUTOMATION;
    else process.env.GAJAE_AUTOMATION = previous;
  });

  const instance = new AutomationService();
  const grants = new AutomationGrantStore(memoryStorage());
  Object.defineProperty(instance, 'grants', { value: grants });
  const dispatched: Dispatched[] = [];
  let label = '';
  const inventory: string[] = [];
  instance.cua.call = async (tool, args) => {
    if (tool === 'start_session') { label = String(args.session); return { ok: true }; }
    if (tool === 'end_session') return { ok: true, ended: true };
    // Identity resolution reads; recorded separately from agent-visible work.
    if ((tool === 'list_apps' || tool === 'list_windows') && Object.keys(args).length === 0) {
      inventory.push(tool);
      return INVENTORY;
    }
    dispatched.push({ tool, args });
    return { content: [{ type: 'text', text: 'ok' }] };
  };
  return { instance, grants, dispatched, inventory, sessionLabel: () => label };
}

/* -------------------------------------------------------------------------- */
/* Server-side authority                                                      */
/* -------------------------------------------------------------------------- */

test('an ungranted application mutation is rejected at the server execution boundary', async (t) => {
  const { instance, dispatched } = service(t);
  await assert.rejects(
    instance.callComputer('session-a', 'click', { pid: 42, window_id: 7 }),
    /was not granted/u,
  );
  assert.deepEqual(dispatched, [], 'nothing may reach the driver without a grant');
});

test('a denied delivery mode is rejected before any driver round-trip', async (t) => {
  const { instance, dispatched, inventory } = service(t);
  await assert.rejects(
    instance.callComputer('session-a', 'click', { pid: 42, window_id: 7, delivery_mode: 'foreground' }),
    { name: 'CuaPolicyError', message: /foreground delivery is denied/u },
  );
  assert.deepEqual(dispatched, []);
  assert.deepEqual(inventory, [], 'a denied call must not even resolve identity');
});

test('a granted application mutation is accepted and dispatched background-bound', async (t) => {
  const { instance, grants, dispatched, sessionLabel } = service(t);
  grants.grant({ kind: 'application', value: 'com.apple.TextEdit', scope: 'session', sessionId: 'session-a' });

  await instance.callComputer('session-a', 'click', { pid: 42, window_id: 7 });
  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0], {
    tool: 'click',
    args: { pid: 42, window_id: 7, delivery_mode: 'background', scope: 'window', session: sessionLabel() },
  });
});

test('reaching callComputer directly confers no authority', async (t) => {
  const { instance, dispatched } = service(t);
  // The audited gap: authorizeComputer computed authority that nothing consumed.
  const authorization = await instance.authorizeComputer('session-a', { tool: 'click', arguments: { pid: 42 } });
  assert.equal(authorization.granted, false);
  assert.equal(authorization.application, 'com.apple.TextEdit');

  await assert.rejects(instance.callComputer('session-a', 'click', { pid: 42 }), /was not granted/u);
  await assert.rejects(instance.callComputer('session-a', 'type_text', { pid: 42, text: 'x' }), /was not granted/u);
  await assert.rejects(instance.callComputer('session-a', 'launch_app', { bundle_id: 'com.apple.TextEdit' }), /was not granted/u);
  assert.deepEqual(dispatched, []);
});

test('an application grant does not cross session boundaries', async (t) => {
  const { instance, grants, dispatched } = service(t);
  grants.grant({ kind: 'application', value: 'com.apple.TextEdit', scope: 'session', sessionId: 'session-a' });

  await instance.callComputer('session-a', 'click', { pid: 42, window_id: 7 });
  await assert.rejects(instance.callComputer('session-b', 'click', { pid: 42, window_id: 7 }), /was not granted/u);
  assert.equal(dispatched.length, 1);
});

test('a grant for one application does not authorize another', async (t) => {
  const { instance, grants } = service(t);
  grants.grant({ kind: 'application', value: 'com.example.Other', scope: 'always' });
  await assert.rejects(instance.callComputer('session-a', 'click', { pid: 42, window_id: 7 }), /was not granted/u);
});

test('identity is re-resolved at dispatch, so a recycled pid fails closed', async (t) => {
  const { instance, grants, dispatched } = service(t);
  grants.grant({ kind: 'application', value: 'com.apple.TextEdit', scope: 'session', sessionId: 'session-a' });
  await instance.callComputer('session-a', 'click', { pid: 42, window_id: 7 });

  // The approved pid now belongs to a different application.
  instance.cua.call = async (tool, args) => {
    if (tool === 'start_session') return { ok: true };
    if (tool === 'list_apps' || tool === 'list_windows') {
      return { structuredContent: { apps: [{ pid: 42, bundle_id: 'com.example.Imposter', name: 'Imposter' }] } };
    }
    dispatched.push({ tool, args });
    return { ok: true };
  };
  await assert.rejects(instance.callComputer('session-a', 'click', { pid: 42, window_id: 7 }), /was not granted/u);
  assert.equal(dispatched.length, 1, 'the recycled pid must not reuse the old approval');
});

test('read-only discovery stays available without an application grant', async (t) => {
  const { instance } = service(t);
  for (const tool of ['list_apps', 'get_accessibility_tree', 'list_windows'] as const) {
    await assert.doesNotReject(instance.callComputer('session-a', tool, {}), tool);
  }
  // A pid filter turns a discovery read into an application-bound one.
  await assert.rejects(instance.callComputer('session-a', 'list_windows', { pid: 42 }), /was not granted/u);
});

test('move_cursor lost its discovery exemption and now needs an application grant', async (t) => {
  const { instance, grants, dispatched } = service(t);
  const args = { scope: 'window', target: { kind: 'window', pid: 42, window_id: 7 }, x: 1, y: 2 };
  await assert.rejects(instance.callComputer('session-a', 'move_cursor', args), /was not granted/u);
  assert.deepEqual(dispatched, []);

  grants.grant({ kind: 'application', value: 'com.apple.TextEdit', scope: 'session', sessionId: 'session-a' });
  await instance.callComputer('session-a', 'move_cursor', args);
  assert.equal(dispatched.length, 1);
});

test('session lifecycle still starts and ends without an application grant', async (t) => {
  const { instance, sessionLabel } = service(t);
  await instance.callComputer('session-a', 'start_session', {});
  assert.match(sessionLabel(), /^gajae-/u);
  assert.deepEqual(await instance.callComputer('session-a', 'end_session', {}), { ok: true, ended: true });
});

/* -------------------------------------------------------------------------- */
/* The guard sits at the driver transport                                     */
/* -------------------------------------------------------------------------- */

test('the driver client refuses a denied call before it starts any transport', async () => {
  const client = new CuaDriverClient();
  // No driver is installed in this test; a policy denial must still win, which
  // proves the guard runs ahead of process spawn rather than beside it.
  await assert.rejects(client.call('click', { pid: 42, window_id: 7, delivery_mode: 'foreground' }),
    { name: 'CuaPolicyError', message: /foreground delivery is denied/u });
  await assert.rejects(client.call('press_key', { key: 'return', scope: 'desktop' }),
    { name: 'CuaPolicyError', message: /unbound whole-desktop input/u });
  await assert.rejects(client.call('move_cursor', { scope: 'desktop', x: 1, y: 2 }),
    { name: 'CuaPolicyError', message: /moves the real OS pointer/u });
});

/* -------------------------------------------------------------------------- */
/* Both external callers reach the same policy                                */
/* -------------------------------------------------------------------------- */

async function bridgeCall(socketPath: string, token: string, request: Record<string, unknown>) {
  const socket = net.createConnection(socketPath);
  await once(socket, 'connect');
  socket.write(`${JSON.stringify({ id: 'req-1', token, ...request })}\n`);
  const [chunk] = await once(socket, 'data');
  socket.destroy();
  return JSON.parse(String(chunk)) as { ok: boolean; error?: string };
}

test('the authenticated bridge and the HTTP route share one authority policy',
  { skip: process.platform === 'win32' }, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'pr03-authority-'));
    const previousSocket = process.env.GAJAE_AUTOMATION_SOCKET;
    process.env.GAJAE_AUTOMATION_SOCKET = join(directory, 'bridge.sock');
    const { instance, grants, dispatched } = service(t);
    t.after(async () => {
      await instance.shutdown();
      if (previousSocket === undefined) delete process.env.GAJAE_AUTOMATION_SOCKET;
      else process.env.GAJAE_AUTOMATION_SOCKET = previousSocket;
      await rm(directory, { recursive: true, force: true });
    });

    await instance.startBridge();
    const socketPath = process.env.GJC_AUTOMATION_SOCKET!;
    const token = process.env.GJC_AUTOMATION_TOKEN!;

    // Bridge caller, no grant: rejected.
    const ungranted = await bridgeCall(socketPath, token, {
      surface: 'computer', sessionId: 'session-a', tool: 'click', arguments: { pid: 42, window_id: 7 },
    });
    assert.equal(ungranted.ok, false);
    assert.match(ungranted.error!, /was not granted/u);

    // Bridge caller requesting foreground, no grant: rejected.
    const foreground = await bridgeCall(socketPath, token, {
      surface: 'computer', sessionId: 'session-a', tool: 'click',
      arguments: { pid: 42, window_id: 7, delivery_mode: 'foreground' },
    });
    assert.equal(foreground.ok, false);

    // The HTTP route is a different caller reaching the same method.
    await assert.rejects(
      instance.callComputer('session-a', 'click', { pid: 42, window_id: 7 }),
      /was not granted/u,
      'POST /api/automation/computer/:sessionId/call funnels through callComputer',
    );
    assert.equal(dispatched.length, 0);

    // With a grant, the same bridge request succeeds, still background-bound.
    grants.grant({ kind: 'application', value: 'com.apple.TextEdit', scope: 'session', sessionId: 'session-a' });
    const granted = await bridgeCall(socketPath, token, {
      surface: 'computer', sessionId: 'session-a', tool: 'click', arguments: { pid: 42, window_id: 7 },
    });
    assert.equal(granted.ok, true, granted.error);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0]!.args.delivery_mode, 'background');

    // A granted session still cannot escalate to foreground.
    const escalation = await bridgeCall(socketPath, token, {
      surface: 'computer', sessionId: 'session-a', tool: 'click',
      arguments: { pid: 42, window_id: 7, delivery_mode: 'foreground' },
    });
    assert.equal(escalation.ok, false);
    assert.match(escalation.error!, /foreground delivery is denied/u);
    assert.equal(dispatched.length, 1);
  });
