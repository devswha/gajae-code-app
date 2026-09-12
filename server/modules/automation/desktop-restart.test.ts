import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test, { type TestContext } from 'node:test';


import type { DesktopWorkAdmission } from '@/shared/interfaces.js';

import type { DesktopOwnerActivity } from '../../../shared/desktopUpdateProtocol.js';

import {
  AutomationService, configureDesktopRestartAdmission, createAutomationDesktopRestartReader,
  createBrowserDesktopRestartReader, createComputerDesktopRestartReader,
} from './automation.service.js';
import { CuaDriverClient } from './cua-client.js';

class Admission implements DesktopWorkAdmission {
  fenced = false;
  active = 0;
  sources: string[] = [];
  enter(source: string): () => void {
    this.sources.push(source);
    if (this.fenced) throw new Error('restart fenced');
    this.active++;
    let released = false;
    return () => {
      assert.equal(released, false, 'admission must release exactly once');
      released = true;
      this.active--;
    };
  }
  enterCompletion(): () => void { throw new Error('new automation must not claim completion admission'); }
}

type WireRequest = {
  id: string;
  method: string;
  params?: { name?: string; arguments?: { session?: string } };
};

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode = null;
  kills = 0;
  calls: WireRequest[] = [];
  constructor() {
    super();
    this.stdin.on('data', (bytes: Buffer) => {
      for (const line of bytes.toString().trim().split('\n')) this.calls.push(JSON.parse(line) as WireRequest);
    });
  }
  kill(): boolean { this.kills++; return true; }
  close(): void {
    this.exitCode = 0;
    this.stdout.end();
    this.stderr.end();
    this.emit('close', 0);
  }
  cuaReply(request: WireRequest, result: unknown = { ok: true }): void {
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
  }
}

function children(t: TestContext) {
  const processes: FakeChild[] = [];
  const spawn = t.mock.method(childProcess, 'spawn', () => {
    const child = new FakeChild();
    processes.push(child);
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    for (const child of processes) if (child.exitCode === null) child.close();
    spawn.mock.restore();
    syncBuiltinESMExports();
  });
  return { processes, spawn };
}

function environment(t: TestContext, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
}

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 1_000; i++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  assert.fail('expected asynchronous transition did not happen');
}

function idle(activity: DesktopOwnerActivity): void {
  assert.equal(activity.complete, true);
  assert.deepEqual(activity.unknown, []);
  for (const field of ['starting', 'queued', 'running', 'settling', 'retained', 'approvals'] as const) {
    assert.equal(activity[field], 0, `${activity.owner}.${field}`);
  }
}

async function initializeCua(fixture: ReturnType<typeof children>) {
  await until(() => Boolean(fixture.processes.at(-1)?.calls.length));
  const child = fixture.processes.at(-1)!;
  assert.equal(child.calls[0]!.method, 'initialize');
  child.cuaReply(child.calls[0]!);
  await until(() => child.calls.some((call) => call.method === 'tools/call'));
  return child;
}

test('all three readers are pure, complete for healthy unused owners, and independent snapshots', async (t) => {
  const fixture = children(t);
  const admission = new Admission();
  const service = new AutomationService();
  configureDesktopRestartAdmission(admission, service);
  const readers = [createAutomationDesktopRestartReader(service), createBrowserDesktopRestartReader(service.browser), createComputerDesktopRestartReader(service)];
  for (const reader of readers) {
    const generation = reader.getGeneration();
    const snapshot = await reader.read();
    idle(snapshot);
    assert.equal(snapshot.generation, generation);
    (snapshot.unknown as string[]).push('caller_mutation');
    idle(await reader.read());
    assert.equal(reader.getGeneration(), generation);
  }
  assert.equal(fixture.spawn.mock.callCount(), 0);
  assert.deepEqual(admission.sources, []);
});

test('fenced direct service and client producers reject before startup, label creation or dispatch', async (t) => {
  environment(t, { GAJAE_AUTOMATION: '1', CUA_DRIVER_PATH: process.execPath });
  const fixture = children(t);
  const admission = new Admission();
  const service = new AutomationService(admission);
  admission.fenced = true;
  const generation = service.getGeneration();
  const operations = [
    () => service.openBrowser('session', {}),
    () => service.commandBrowser('session', { action: 'reload' }),
    () => service.authorizeBrowser('session', {}),
    () => service.authorizeComputer('session', { tool: 'list_apps' }),
    () => service.callComputer('session', 'start_session', {}),
    () => service.stopSession('session'),
    () => service.startBridge(),
    () => service.status(),
    () => service.cua.call('start_session', {}),
    () => service.cua.status(),
  ];
  for (const operation of operations) await assert.rejects(operation(), /fenced/);
  assert.equal(fixture.spawn.mock.callCount(), 0);
  assert.equal(service.getGeneration(), generation);
  idle(service.snapshotActivity());
  idle(await service.browser.snapshotActivity());
  idle(service.cua.snapshotActivity());
  assert.equal(admission.active, 0);
});

test('CUA named session ownership survives cancellation and is released by late end acknowledgment', async (t) => {
  environment(t, { GAJAE_AUTOMATION: '1', CUA_DRIVER_PATH: process.execPath });
  const fixture = children(t);
  const admission = new Admission();
  const service = new AutomationService(admission);
  const start = service.callComputer('session', 'start_session', {});
  assert.equal(service.snapshotActivity().retained, 1, 'session label is owned before executable lookup');
  assert.ok(service.cua.snapshotActivity().starting > 0);
  const child = await initializeCua(fixture);
  child.cuaReply(child.calls.at(-1)!);
  await start;
  const reader = createComputerDesktopRestartReader(service);
  assert.equal(reader.read().retained, 2, 'service label and original start request both retain the session');
  assert.equal(reader.read().running, 0);
  const controller = new AbortController();
  const end = service.callComputer('session', 'end_session', {}, controller.signal);
  const rejected = assert.rejects(end, /cancelled/);
  await until(() => child.calls.at(-1)?.params?.name === 'end_session');
  const request = child.calls.at(-1)!;
  assert.ok(service.snapshotActivity().settling > 0);
  controller.abort();
  await rejected;
  assert.equal(admission.active, 0);
  assert.equal(reader.read().complete, false);
  assert.equal(reader.read().retained, 2);
  assert.ok(child.calls.some((call) => call.method === 'notifications/cancelled'));
  const generation = reader.getGeneration();
  child.cuaReply(request);
  idle(await reader.read());
  idle(service.snapshotActivity());
  assert.notEqual(reader.getGeneration(), generation);
});

test('CUA timed-out requests survive transport exit and replacement at the same session name', async (t) => {
  environment(t, { CUA_DRIVER_PATH: process.execPath });
  const fixture = children(t);
  const client = new CuaDriverClient();
  const first = client.call('start_session', { session: 'same-label' });
  const oldChild = await initializeCua(fixture);
  oldChild.cuaReply(oldChild.calls.at(-1)!);
  await first;
  const request = client as unknown as {
    request(method: string, params: Record<string, unknown>, timeout: number): Promise<unknown>;
  };
  await assert.rejects(request.request('tools/call', { name: 'list_apps', arguments: {} }, 5), /timed out/);
  assert.equal(client.snapshotActivity().complete, false);
  oldChild.close();
  const next = client.call('start_session', { session: 'same-label' });
  await until(() => fixture.processes.length === 2);
  const child = await initializeCua(fixture);
  child.cuaReply(child.calls.at(-1)!);
  await next;
  assert.equal(client.snapshotActivity().retained, 2, 'replacement must not erase an older transport owner');
  const end = client.call('end_session', { session: 'same-label' });
  await until(() => child.calls.at(-1)?.params?.name === 'end_session');
  oldChild.emit('close', 0);
  child.cuaReply(child.calls.at(-1)!);
  await end;
  assert.equal(client.snapshotActivity().retained, 1);
  assert.equal(client.snapshotActivity().running, 1);
  assert.deepEqual(client.snapshotActivity().unknown, ['cua_request_unconfirmed']);
});

test('failed computer cleanup retains its label and a retry can prove healthy idle', async (t) => {
  environment(t, { GAJAE_AUTOMATION: '1' });
  const service = new AutomationService();
  let failEnd = true;
  service.cua.call = async (tool) => tool === 'end_session' && failEnd
    ? { isError: true, content: [{ text: 'cleanup failed' }] } : { ok: true };
  await service.callComputer('session', 'start_session', {});
  await assert.rejects(service.callComputer('session', 'end_session', {}), /cleanup failed/);
  assert.equal(service.snapshotActivity().retained, 1);
  assert.deepEqual(service.snapshotActivity().unknown, ['computer_session_unconfirmed']);
  failEnd = false;
  await service.callComputer('session', 'end_session', {});
  idle(service.snapshotActivity());
});

test('computer close waits for an already-owned session start instead of forgetting its label', async (t) => {
  environment(t, { GAJAE_AUTOMATION: '1', CUA_DRIVER_PATH: process.execPath });
  const fixture = children(t);
  const service = new AutomationService();
  const start = service.callComputer('session', 'start_session', {});
  const end = service.callComputer('session', 'end_session', {});
  const child = await initializeCua(fixture);
  assert.equal(child.calls.filter((call) => call.params?.name === 'start_session').length, 1);
  assert.equal(child.calls.filter((call) => call.params?.name === 'end_session').length, 0);
  assert.equal(service.snapshotActivity().retained, 1);
  assert.ok(service.snapshotActivity().settling > 0);
  const startRequest = child.calls.at(-1)!;
  child.cuaReply(startRequest);
  await start;
  await until(() => child.calls.at(-1)?.params?.name === 'end_session');
  assert.equal(child.calls.at(-1)!.params?.arguments?.session, startRequest.params?.arguments?.session);
  child.cuaReply(child.calls.at(-1)!);
  await end;
  idle(createComputerDesktopRestartReader(service).read());
});

test('CUA inspection deadline keeps admission and unknown ownership until all processes close', async (t) => {
  environment(t, { CUA_DRIVER_PATH: process.execPath });
  const fixture = children(t);
  const admission = new Admission();
  const client = new CuaDriverClient({ desktopRestartAdmission: admission });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const status = client.status();
  const expected = process.platform === 'darwin' ? 3 : 2;
  for (let i = 0; i < 1_000 && fixture.processes.length < expected; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(fixture.processes.length, expected);
  const generation = client.getGeneration();
  t.mock.timers.tick(3_000);
  assert.equal(admission.active, 1);
  assert.deepEqual(client.snapshotActivity().unknown, ['cua_inspection_unconfirmed']);
  assert.notEqual(client.getGeneration(), generation);
  for (const child of fixture.processes.slice(0, -1)) child.close();
  assert.equal(client.snapshotActivity().complete, false);
  fixture.processes.at(-1)!.close();
  await status;
  assert.equal(admission.active, 0);
  idle(client.snapshotActivity());
});

async function bridge(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'automation-admission-'));
  environment(t, { GAJAE_AUTOMATION: '1', GAJAE_AUTOMATION_SOCKET: join(directory, 'bridge.sock') });
  const admission = new Admission();
  const service = new AutomationService(admission);
  await service.startBridge();
  const socket = net.createConnection(process.env.GJC_AUTOMATION_SOCKET!);
  await once(socket, 'connect');
  t.after(async () => {
    socket.destroy();
    await service.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const send = (token = process.env.GJC_AUTOMATION_TOKEN) => socket.write(`${JSON.stringify({
    id: 'request', token, sessionId: 'session', surface: 'browser', operation: 'open', payload: {},
  })}\n`);
  return { admission, service, socket, send };
}

test('direct Unix bridge authenticates before admission and rejects fenced dispatch', { skip: process.platform === 'win32' }, async (t) => {
  const { admission, service, socket, send } = await bridge(t);
  service.openBrowser = async () => { assert.fail('fenced bridge must not dispatch'); };
  admission.fenced = true;
  const count = admission.sources.length;
  send('invalid-token');
  let [data] = await once(socket, 'data');
  assert.match(data.toString(), /Unauthorized/);
  assert.equal(admission.sources.length, count);
  send();
  [data] = await once(socket, 'data');
  assert.match(data.toString(), /fenced/);
  assert.equal(admission.sources.at(-1), 'automation.bridge.request');
  idle(service.snapshotActivity());
});

test('bridge socket close cannot release an executing handler before its actual promise settles', { skip: process.platform === 'win32' }, async (t) => {
  const { admission, service, socket, send } = await bridge(t);
  let finish!: (value: unknown) => void;
  service.openBrowser = () => new Promise((resolve) => { finish = resolve; });
  send();
  await until(() => Boolean(finish));
  socket.destroy();
  await once(socket, 'close');
  assert.equal(admission.active, 1);
  assert.equal(service.snapshotActivity().running, 1);
  const generation = service.getGeneration();
  finish({ opened: false });
  await until(() => admission.active === 0);
  idle(service.snapshotActivity());
  assert.notEqual(service.getGeneration(), generation);
});
