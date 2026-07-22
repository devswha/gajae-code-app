import assert from 'node:assert/strict';
import { spawn as spawnChild } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { after, test } from 'node:test';

import { GjcWorkerSupervisor, killWorkerTree, resolveGjcResumeSessionRoot } from './gjc-worker-client.js';
import {
  GJC_WINDOWS_JOB_GUARD_ACK,
  GJC_WINDOWS_JOB_GUARD_READY,
} from './gjc-windows-job.js';
import {
  GJC_WORKER_PROTOCOL_VERSION,
  GjcWorkerNdjsonDecoder,
  serializeGjcWorkerFrame,
  GJC_WORKER_MAX_FRAME_BYTES,
  type GjcWorkerEventFrame,
  type GjcWorkerRequestFrame,
  type GjcWorkerResponseFrame,
  type JsonObject,
} from './gjc-worker-protocol.js';
let runSequence = 0;
function spawn(
  supervisor: GjcWorkerSupervisor,
  message: string,
  options: Parameters<GjcWorkerSupervisor['spawnRun']>[0]['options'] = {},
  writer: Parameters<GjcWorkerSupervisor['spawnRun']>[0]['writer'],
): Promise<void> & { abortHandle: string } {
  const appSessionId = writer.getAppSessionId?.()
    ?? (supervisor as unknown as { runtime: { createScope?: () => string } }).runtime.createScope?.()
    ?? 'app-session-1';
  const run = supervisor.spawnRun({
    runId: `test-run-${++runSequence}`,
    appSessionId,
    message,
    options,
    writer,
  });
  const completion = run.completion as Promise<void> & { abortHandle: string };
  completion.abortHandle = run.abortHandle;
  return completion;
}

test('resume root resolution selects either allowlisted store from indexed session metadata', async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'gjc-resume-enrichment-'));
  const liveRoot = join(tempDirectory, 'live-sessions');
  const savedRoot = join(homedir(), '.gjc', 'agent', 'sessions');
  const savedDirectory = join(savedRoot, `gjc-worker-client-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    await Promise.all([mkdir(liveRoot, { recursive: true }), mkdir(savedDirectory, { recursive: true })]);
    const paths = {
      live: join(liveRoot, 'live.jsonl'),
      saved: join(savedDirectory, 'saved.jsonl'),
    };
    await Promise.all([writeFile(paths.live, '{}\n'), writeFile(paths.saved, '{}\n')]);
    const lookup = async (sessionId: string) => paths[sessionId as keyof typeof paths];

    // The resolver returns the canonical (realpath) root; macOS resolves the
    // temp store under /var to /private/var, so normalize expectations too.
    assert.equal(await resolveGjcResumeSessionRoot('live', liveRoot, lookup), await realpath(liveRoot));
    assert.equal(await resolveGjcResumeSessionRoot('saved', liveRoot, lookup), await realpath(savedRoot));
  } finally {
    await Promise.all([
      rm(tempDirectory, { recursive: true, force: true }),
      rm(savedDirectory, { recursive: true, force: true }),
    ]);
  }
});
// The supervisor intentionally unrefs its internal timers so a shutting-down
// application is never kept alive. Tests that await only those timers would let
// the event loop drain before they fire (observed on macOS), so hold one
// referenced handle for the lifetime of this file.
const keepAlive = setInterval(() => {}, 60_000);
after(() => clearInterval(keepAlive));

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit('exit', 0);
    this.emit('close', 0);
    return true;
  }
}
class ReapFakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 12_345;
  killCount = 0;

  kill(): boolean {
    this.killCount += 1;
    return true;
  }
}

class FakePeer {
  readonly requests: GjcWorkerRequestFrame[] = [];
  readonly #decoder = new GjcWorkerNdjsonDecoder();
  #handler: (request: GjcWorkerRequestFrame) => void = () => {};

  constructor(readonly child: FakeChild, guarded = false) {
    let guardInput = Buffer.alloc(0);
    child.stdin.on('data', (chunk: Buffer) => {
      let protocolChunk = chunk;
      if (guarded) {
        guardInput = Buffer.concat([guardInput, chunk]);
        const newline = guardInput.indexOf(0x0a);
        if (newline < 0) return;
        assert.equal(
          guardInput.subarray(0, newline).toString('utf8'),
          GJC_WINDOWS_JOB_GUARD_ACK,
        );
        protocolChunk = guardInput.subarray(newline + 1);
        guardInput = Buffer.alloc(0);
        guarded = false;
      }
      if (protocolChunk.length === 0) return;
      for (const frame of this.#decoder.push(protocolChunk)) {
        assert.equal(frame.kind, 'request');
        const request = frame as GjcWorkerRequestFrame;
        this.requests.push(request);
        this.#handler(request);
      }
    });
  }

  handle(handler: (request: GjcWorkerRequestFrame) => void): void {
    this.#handler = handler;
  }

  respond(
    request: GjcWorkerRequestFrame,
    payload: GjcWorkerResponseFrame['payload'] = { ok: true },
  ): void {
    const frame = {
      protocolVersion: GJC_WORKER_PROTOCOL_VERSION,
      kind: 'response',
      id: request.id,
      method: request.method,
      ...('sessionId' in request ? { sessionId: request.sessionId } : {}),
      payload,
    } as GjcWorkerResponseFrame;
    this.child.stdout.write(serializeGjcWorkerFrame(frame));
  }

  event(
    sessionId: string,
    runId: string,
    method: Exclude<GjcWorkerEventFrame['method'], 'worker.status'>,
    payload: JsonObject = {},
  ): void {
    const frame: GjcWorkerEventFrame = {
      protocolVersion: GJC_WORKER_PROTOCOL_VERSION,
      kind: 'event',
      id: `event-${this.requests.length}-${Math.random()}`,
      method,
      sessionId,
      payload: { runId, ...payload },
    };
    this.child.stdout.write(serializeGjcWorkerFrame(frame));
  }

  status(sessionId: string, runId: string, processId: number | null): void {
    const frame: GjcWorkerEventFrame = {
      protocolVersion: GJC_WORKER_PROTOCOL_VERSION,
      kind: 'event',
      id: `status-${this.requests.length}-${Math.random()}`,
      method: 'worker.status',
      sessionId,
      payload: { runId, processId },
    };
    this.child.stdout.write(serializeGjcWorkerFrame(frame));
  }

  async waitFor(
    method: GjcWorkerRequestFrame['method'],
    count = 1,
  ): Promise<GjcWorkerRequestFrame> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const matches = this.requests.filter((request) => request.method === method);
      if (matches.length >= count) return matches[count - 1];
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error(`Timed out waiting for ${method}.`);
  }
}

function runtime(child: FakeChild, scope = 'app-session-1') {
  return {
    spawn: () => child,
    corePath: '/test/gajae-core',
    workerPath: '/test/gjc-bun-worker.js',
    bunPath: '/test/bun',
    compiled: true,
    createScope: () => scope,
    notifyRunStopped: () => {},
    notifyRunFailed: () => {},
  };
}
test('killWorkerTree reaps a process group that forms after the initial kill', async () => {
  const child = new ReapFakeChild();
  let groupKillCount = 0;
  let closeScheduled = false;
  const esrch = (): Error & { code: string } => Object.assign(new Error('No such process.'), { code: 'ESRCH' });
  const kill = (pid: number, signal: NodeJS.Signals | 0): void => {
    assert.equal(pid, -child.pid);
    if (signal === 0) throw esrch();

    groupKillCount += 1;
    if (groupKillCount < 3) throw esrch();
    if (!closeScheduled) {
      closeScheduled = true;
      queueMicrotask(() => child.emit('close', 0));
    }
  };

  await killWorkerTree(child, 'darwin', kill);

  assert.equal(groupKillCount >= 3, true);
  assert.equal(child.killCount >= 2, true);
});

test('killWorkerTree rejects when a process group cannot be verified as terminated', { timeout: 6_000 }, async () => {
  const child = new ReapFakeChild();
  const kill = (pid: number, signal: NodeJS.Signals | 0): void => {
    assert.equal(pid, -child.pid);
    if (signal === 0) return;
  };

  await assert.rejects(
    killWorkerTree(child, 'darwin', kill),
    /GJC worker tree termination timed out/,
  );
});
test('killWorkerTree waits through an EPERM process-group verification window', { timeout: 1_000 }, async () => {
  const child = new ReapFakeChild();
  let probeCount = 0;
  let closeScheduled = false;
  const eperm = (): Error & { code: string } => Object.assign(new Error('Operation not permitted.'), { code: 'EPERM' });
  const esrch = (): Error & { code: string } => Object.assign(new Error('No such process.'), { code: 'ESRCH' });
  const kill = (pid: number, signal: NodeJS.Signals | 0): void => {
    assert.equal(pid, -child.pid);
    if (signal === 'SIGKILL') throw eperm();

    probeCount += 1;
    if (probeCount <= 10) throw eperm();
    if (!closeScheduled) {
      closeScheduled = true;
      queueMicrotask(() => child.emit('close', 0));
    }
    throw esrch();
  };

  await killWorkerTree(child, 'darwin', kill);

  assert.equal(probeCount, 12);
  assert.equal(child.killCount >= 11, true);
});

test('killWorkerTree fails closed when process-group verification remains EPERM', { timeout: 6_000 }, async () => {
  const child = new ReapFakeChild();
  const eperm = (): Error & { code: string } => Object.assign(new Error('Operation not permitted.'), { code: 'EPERM' });
  const kill = (pid: number, signal: NodeJS.Signals | 0): void => {
    assert.equal(pid, -child.pid);
    throw eperm();
  };

  await assert.rejects(
    killWorkerTree(child, 'darwin', kill),
    /GJC worker tree termination timed out/,
  );
});

function replyToHandshake(peer: FakePeer): void {
  peer.handle((request) => {
    if (request.method === 'worker.initialize') peer.respond(request);
  });
}

test('launches the Windows worker behind an atomic kill-on-close job guard', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child, true);
  peer.handle((request) => peer.respond(request));
  let command = '';
  let args: string[] = [];
  let spawnOptions: {
    detached?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {};
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(child),
    platform: 'win32',
    environment: {
      SystemRoot: 'C:\\Windows',
      KEEP_ME: 'yes',
    },
    spawn: (workerCommand, workerArgs, options) => {
      command = workerCommand;
      args = workerArgs;
      spawnOptions = options;
      return child;
    },
  });

  const run = spawn(supervisor, 'hello', {}, { send() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peer.requests.length, 0);
  child.stdout.write(`${GJC_WINDOWS_JOB_GUARD_READY}\n`);
  await run;

  assert.equal(
    command,
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
  assert.equal(args.at(-2), '-EncodedCommand');
  assert.equal(spawnOptions.detached, false);
  assert.equal(spawnOptions.env?.KEEP_ME, 'yes');
  assert.equal(
    spawnOptions.env?.GAJAE_INTERNAL_JOB_APPLICATION,
    '/test/gajae-core',
  );
  assert.equal(
    peer.requests.filter((request) => request.method === 'worker.initialize').length,
    1,
  );
  assert.match(
    spawnOptions.env?.GAJAE_INTERNAL_JOB_COMMAND_LINE ?? '',
    /gjc-bun-worker\.js/,
  );
});

test('fails closed when the Windows job guard never proves app ownership', async () => {
  const child = new FakeChild();
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(child),
    platform: 'win32',
    environment: { SystemRoot: 'C:\\Windows' },
    initializeTimeoutMs: 5,
  });

  await assert.rejects(
    spawn(supervisor, 'hello', {}, { send() {} }),
    /GJC worker failed/,
  );

  assert.equal(child.killed, false);
});

test('shares one handshake and sends one start request per concurrent run', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  peer.handle((request) => peer.respond(request));
  let command = '';
  let args: string[] = [];
  let detached: boolean | undefined;
  let launchEnvironment: NodeJS.ProcessEnv | undefined;
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(child),
    spawn: (workerCommand, workerArgs, options) => {
      command = workerCommand;
      args = workerArgs;
      detached = options.detached;
      launchEnvironment = options.env;
      return child;
    },
  });

  await Promise.all([
    spawn(supervisor, 'first', { sessionId: null, model: 'x' }, { send() {} }),
    spawn(supervisor, 'second', {}, { send() {} }),
  ]);

  assert.equal(peer.requests.filter((request) => request.method === 'worker.initialize').length, 1);
  const starts = peer.requests.filter((request) => request.method === 'session.start');
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[0]?.payload, { message: 'first', options: { model: 'x' } });
  assert.equal(peer.requests.some((request) => request.method === 'turn.start'), false);
  assert.equal(detached, process.platform !== 'win32');
  assert.equal(environmentExtendsProcessEnvWithAgentDir(launchEnvironment), true);
  assert.equal(command, '/test/gajae-core');
  assert.deepEqual(args, ['--', '/test/bun', '/test/gjc-bun-worker.js']);
});
test('spawnRun preserves caller-owned identifiers and resolves started when its request is written', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  const supervisor = new GjcWorkerSupervisor(runtime(child));
  const run = supervisor.spawnRun({
    runId: 'run-caller-owned',
    appSessionId: 'app-caller-owned',
    message: 'hello',
    options: {},
    writer: { send() {} },
  });
  peer.respond(await peer.waitFor('worker.initialize'));
  const request = await peer.waitFor('session.start');
  await run.started;
  assert.equal(request.id, 'run-caller-owned');
  assert.equal('sessionId' in request ? request.sessionId : undefined, 'app-caller-owned');
  peer.respond(request);
  await run.completion;
  assert.equal(await run.outcome, 'completed');
});
test('rejects an oversized start frame as not_started without terminating its worker generation', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  const supervisor = new GjcWorkerSupervisor(runtime(child));
  const oversized = supervisor.spawnRun({
    runId: 'oversized-start',
    appSessionId: 'app-oversized',
    message: 'x'.repeat(GJC_WORKER_MAX_FRAME_BYTES),
    options: {},
    writer: { send() {} },
  });
  peer.respond(await peer.waitFor('worker.initialize'));
  await assert.rejects(oversized.started);
  assert.equal(await oversized.outcome, 'not_started');
  assert.equal(child.killed, false);

  const next = spawn(supervisor, 'hello', {}, { send() {} });
  peer.respond(await peer.waitFor('session.start'));
  await next;
});

/**
 * The launch env is process.env extended by exactly one injected key:
 * GJC_WORKER_AGENT_DIR (explicit app-owned auth/config injection, F12).
 */
function environmentExtendsProcessEnvWithAgentDir(environment: NodeJS.ProcessEnv | undefined): boolean {
  if (!environment) return false;
  const keys = new Set(Object.keys(environment));
  if (typeof environment.GJC_WORKER_AGENT_DIR !== 'string' || environment.GJC_WORKER_AGENT_DIR.length === 0) return false;
  for (const key of Object.keys(process.env)) {
    if (key === 'GJC_WORKER_AGENT_DIR') continue;
    if (environment[key] !== process.env[key]) return false;
    keys.delete(key);
  }
  keys.delete('GJC_WORKER_AGENT_DIR');
  return keys.size === 0;
}

test('wraps the source worker with Bun while only adding the injected agent directory', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  peer.handle((request) => peer.respond(request));
  let args: string[] = [];
  let environment: NodeJS.ProcessEnv | undefined;
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(child),
    compiled: false,
    workerPath: '/test/gjc-bun-worker.ts',
    spawn: (_command, workerArgs, options) => {
      args = workerArgs;
      environment = options.env;
      return child;
    },
  });

  await spawn(supervisor, 'source', {}, { send() {} });

  assert.deepEqual(args, ['--', '/test/bun', '/test/gjc-bun-worker.ts']);
  assert.equal(environmentExtendsProcessEnvWithAgentDir(environment), true);
});

test('fails safely when the native core cannot launch without a Node fallback', async () => {
  const commands: string[] = [];
  const supervisor = new GjcWorkerSupervisor({
    corePath: '/missing/gajae-core',
    workerPath: '/test/gjc-worker.js',
    compiled: true,
    bunPath: '/test/bun',
    spawn: (command) => {
      commands.push(command);
      throw new Error('missing');
    },
    notifyRunStopped: () => {},
    notifyRunFailed: () => {},
  });

  await assert.rejects(
    spawn(supervisor, 'hello', {}, { send() {} }),
    /GJC worker failed/,
  );
  assert.deepEqual(commands, ['/missing/gajae-core']);
});

test('resumes by provider session and forwards events using immutable run identity', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  const messages: unknown[] = [];
  let providerSessionId = '';
  const supervisor = new GjcWorkerSupervisor(runtime(child, 'app-2'));
  const run = spawn(supervisor, 'hello', { sessionId: 'provider-old' }, {
    send: (value) => messages.push(value),
    setSessionId: (id) => { providerSessionId = id; },
  });
  const request = await peer.waitFor('session.resume');

  assert.deepEqual(request.payload, {
    message: 'hello',
    options: {},
    providerSessionId: 'provider-old',
  });
  peer.event('app-2', request.id, 'session.created', { providerSessionId: 'provider-new' });
  peer.event('app-2', request.id, 'message.delta', {
    message: { kind: 'stream_delta', content: 'kept' },
  });
  peer.respond(request);
  await run;

  assert.equal(providerSessionId, 'provider-new');
  assert.deepEqual(
    messages.filter((message) => (message as { kind?: string }).kind === 'stream_delta'),
    [{ kind: 'stream_delta', content: 'kept' }],
  );
});

test('aborting before the start request prevents the run from reaching the worker', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  const supervisor = new GjcWorkerSupervisor(runtime(child, 'app-prestart'));
  const run = spawn(supervisor, 'hello', {}, { send() {} });

  assert.equal(await supervisor.abort(run.abortHandle), 'not_started');
  peer.respond(await peer.waitFor('worker.initialize'));
  await run;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(peer.requests.some((request) => request.method === 'session.start'), false);
  assert.equal(peer.requests.some((request) => request.method === 'turn.abort'), false);
});

test('aborts an issued run by runId and waits for its terminal start response', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  const supervisor = new GjcWorkerSupervisor(runtime(child, 'app-abort'));
  const run = spawn(supervisor, 'hello', {}, { send() {} });
  const start = await peer.waitFor('session.start');
  let settled = false;
  void run.then(() => { settled = true; });

  const abortResult = supervisor.abort(run.abortHandle);
  const abort = await peer.waitFor('turn.abort');
  assert.deepEqual(abort.payload, { runId: start.id });
  peer.respond(abort, { ok: true, result: { runId: start.id, aborted: true } });
  assert.equal(await abortResult, 'aborted');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  peer.respond(start, { ok: true, result: { runId: start.id } });
  await run;
  assert.equal(settled, true);
});

test('keeps a run active when the worker cannot confirm abort', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  const supervisor = new GjcWorkerSupervisor(runtime(child, 'app-abort-failed'));
  const run = spawn(supervisor, 'hello', {}, { send() {} });
  const start = await peer.waitFor('session.start');

  const abortResult = supervisor.abort(run.abortHandle);
  const abort = await peer.waitFor('turn.abort');
  peer.respond(abort, {
    ok: true,
    result: { runId: start.id, aborted: false },
  });

  assert.equal(await abortResult, 'unconfirmed');
  assert.equal(supervisor.isActive(run.abortHandle), true);
  peer.respond(start);
  await run;
});
test('joins concurrent alias termination requests to one worker generation reap', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  let releaseReap!: () => void;
  const reapGate = new Promise<void>((resolve) => { releaseReap = resolve; });
  const supervisor = new GjcWorkerSupervisor({ ...runtime(child), killTree: () => reapGate });
  const first = spawn(supervisor, 'one', {}, { send() {} });
  const second = spawn(supervisor, 'two', {}, { send() {} });
  const firstStart = await peer.waitFor('session.start');
  const secondStart = await peer.waitFor('session.start', 2);
  peer.event('app-session-1', firstStart.id, 'session.created', { providerSessionId: 'provider-one' });
  peer.event('app-session-1', secondStart.id, 'session.created', { providerSessionId: 'provider-two' });

  const firstTermination = supervisor.terminate('provider-one');
  const secondTermination = supervisor.terminate('provider-two');
  releaseReap();

  assert.deepEqual(await Promise.all([firstTermination, secondTermination]), ['reaped', 'reaped']);
  await assert.rejects(first, /GJC worker failed/);
  await assert.rejects(second, /GJC worker failed/);
});

test('mirrors approval replay, reply, and cancellation in app-owned state', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  const messages: unknown[] = [];
  const supervisor = new GjcWorkerSupervisor(runtime(child, 'app-approval'));
  const run = spawn(supervisor, 'hello', {}, { send: (value) => messages.push(value) });
  const start = await peer.waitFor('session.start');
  const approval = { kind: 'permission_request', requestId: 'request-1', toolName: 'Bash' };

  peer.event('app-approval', start.id, 'ask.presented', { message: approval });
  assert.deepEqual(supervisor.pendingApprovals('app-approval'), [approval]);
  assert.equal(supervisor.resolveApproval('request-1', { allow: true }), true);
  const reply = await peer.waitFor('ask.reply');
  assert.deepEqual(reply.payload, {
    runId: start.id,
    requestId: 'request-1',
    decision: { allow: true },
  });
  peer.respond(reply, { ok: true, result: { runId: start.id, accepted: true } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.pendingApprovals('app-approval').length, 0);

  const retryableApproval = { kind: 'permission_request', requestId: 'request-2' };
  peer.event('app-approval', start.id, 'ask.presented', {
    message: retryableApproval,
  });
  assert.equal(supervisor.resolveApproval('request-2', { allow: false }), true);
  const rejectedReply = await peer.waitFor('ask.reply', 2);
  peer.respond(rejectedReply, {
    ok: true,
    result: { runId: start.id, accepted: false },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(supervisor.pendingApprovals('app-approval'), [retryableApproval]);
  assert.equal(
    messages.filter((message) => (
      message as { requestId?: string }
    ).requestId === 'request-2').length,
    2,
  );

  peer.event('app-approval', start.id, 'ask.presented', {
    message: { kind: 'permission_cancelled', requestId: 'request-2' },
  });
  assert.equal(supervisor.pendingApprovals('app-approval').length, 0);
  peer.respond(start);
  await run;
});

test('malformed worker output fails active work once and starts a fresh generation later', async () => {
  const first = new FakeChild();
  const second = new FakeChild();
  const firstPeer = new FakePeer(first);
  const secondPeer = new FakePeer(second);
  replyToHandshake(firstPeer);
  secondPeer.handle((request) => secondPeer.respond(request));
  const children = [first, second];
  let spawnCalls = 0;
  const sent: unknown[] = [];
  const ownedProcessKills: number[] = [];
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(first),
    spawn: () => children[spawnCalls++]!,
    killProcessTree: (processId) => { ownedProcessKills.push(processId); },
    notifyRunFailed: () => {
      throw new Error('notification unavailable');
    },
    diagnostic: () => {
      throw new Error('diagnostic unavailable');
    },
  });
  const run = spawn(supervisor, 'hello', {}, { send: (value) => sent.push(value) });
  const firstStart = await firstPeer.waitFor('session.start');
  firstPeer.status('app-session-1', firstStart.id, 4_242);

  first.stdout.write('not-json\n');
  await assert.rejects(run, /GJC worker failed/);
  assert.equal(first.killed, true);
  assert.equal(sent.filter((value) => (value as { kind?: string }).kind === 'complete').length, 1);
  assert.deepEqual(ownedProcessKills, [4_242]);

  await spawn(supervisor, 'again', {}, { send() {} });
  assert.equal(spawnCalls, 2);
});

test('worker exit waits for tree termination before starting a fresh generation', async () => {
  const first = new FakeChild();
  const second = new FakeChild();
  const firstPeer = new FakePeer(first);
  const secondPeer = new FakePeer(second);
  secondPeer.handle((request) => secondPeer.respond(request));
  const children = [first, second];
  let spawnCalls = 0;
  let releaseTermination!: () => void;
  const termination = new Promise<void>((resolve) => {
    releaseTermination = resolve;
  });
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(first),
    spawn: () => children[spawnCalls++]!,
    killTree: () => termination,
  });
  const failedRun = spawn(supervisor, 'first', {}, { send() {} });
  const failure = failedRun.then(() => assert.fail('worker exit must reject the active run'), () => {});
  await firstPeer.waitFor('worker.initialize');

  first.emit('exit', 1);
  const replacement = spawn(supervisor, 'second', {}, { send() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(spawnCalls, 1);
  releaseTermination();

  await Promise.all([failure, replacement]);
  assert.equal(spawnCalls, 2);
});

test('failed tree cleanup permanently blocks a replacement worker generation', async () => {
  const first = new FakeChild();
  const firstPeer = new FakePeer(first);
  replyToHandshake(firstPeer);
  let spawnCalls = 0;
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(first),
    spawn: () => {
      spawnCalls += 1;
      return first;
    },
    killTree: () => Promise.reject(new Error('tree still alive')),
  });
  const failedRun = supervisor.spawnRun({
    runId: 'failed-reap-run',
    appSessionId: 'app-session-1',
    message: 'first',
    writer: { send() {} },
  });
  await firstPeer.waitFor('session.start');

  first.stdout.write('not-json\n');
  assert.equal(await failedRun.outcome, 'unconfirmed');
  await assert.rejects(
    spawn(supervisor, 'replacement', {}, { send() {} }),
    /GJC worker failed/,
  );

  assert.equal(spawnCalls, 1);
});

test('a timed-out auxiliary request does not corrupt other request correlation', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(child),
    requestTimeoutMs: 5,
  });
  const run = spawn(supervisor, 'hello', {}, { send() {} });
  const start = await peer.waitFor('session.start');

  peer.event('app-session-1', start.id, 'ask.presented', {
    message: { kind: 'permission_request', requestId: 'request-timeout' },
  });
  assert.equal(supervisor.resolveApproval('request-timeout', { allow: true }), true);
  const timedOutReply = await peer.waitFor('ask.reply');
  await new Promise((resolve) => setTimeout(resolve, 15));
  peer.respond(timedOutReply);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(child.killed, false);

  peer.event('app-session-1', start.id, 'ask.presented', {
    message: { kind: 'permission_request', requestId: 'request-success' },
  });
  assert.equal(supervisor.resolveApproval('request-success', { allow: true }), true);
  const successfulReply = await peer.waitFor('ask.reply', 2);
  peer.respond(successfulReply);
  peer.respond(start);
  await run;
  assert.equal(child.killed, false);
});

test('ignores stale events when a later run reuses the same app scope', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  const messages: unknown[] = [];
  const supervisor = new GjcWorkerSupervisor(runtime(child, 'shared-app'));
  const writer = { send: (value: unknown) => messages.push(value) };

  const oldRun = spawn(supervisor, 'old', {}, writer);
  const oldStart = await peer.waitFor('session.start');
  peer.respond(oldStart);
  await oldRun;

  const newRun = spawn(supervisor, 'new', {}, writer);
  const newStart = await peer.waitFor('session.start', 2);
  peer.event('shared-app', oldStart.id, 'message.delta', {
    message: { kind: 'stream_delta', content: 'stale' },
  });
  peer.event('shared-app', newStart.id, 'message.delta', {
    message: { kind: 'stream_delta', content: 'current' },
  });
  peer.respond(newStart);
  await newRun;

  assert.deepEqual(
    messages.filter((message) => (message as { kind?: string }).kind === 'stream_delta'),
    [{ kind: 'stream_delta', content: 'current' }],
  );
});

test('forwards one worker terminal event without synthesizing a duplicate', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  const sent: unknown[] = [];
  let failures = 0;
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(child, 'app-terminal'),
    notifyRunFailed: () => { failures += 1; },
  });
  const run = spawn(supervisor, 'hello', {}, { send: (value) => sent.push(value) });
  const start = await peer.waitFor('session.start');
  const terminal = { kind: 'complete', provider: 'gjc', exitCode: 1 };

  peer.event('app-terminal', start.id, 'turn.failed', { message: terminal });
  peer.respond(start, { ok: false, error: { code: 'run_failed', message: 'safe' } });
  await assert.rejects(run, /GJC worker failed/);

  assert.deepEqual(sent, [terminal]);
  assert.equal(failures, 1);
});
test('durable-job notification ownership suppresses direct GJC terminal sends', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  let failures = 0;
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(child, 'app-terminal-owned'),
    notifyRunFailed: () => { failures += 1; },
  });
  const run = spawn(
    supervisor,
    'hello',
    { notificationOwner: 'terminal-adapter' },
    { send() {} },
  );
  const start = await peer.waitFor('session.start');
  peer.respond(start, { ok: false, error: { code: 'run_failed', message: 'safe' } });
  await assert.rejects(run, /GJC worker failed/);
  assert.equal(failures, 0);
});

test('completed terminal event remains authoritative if the worker exits before its response', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  const sent: unknown[] = [];
  let stopped = 0;
  let failed = 0;
  const ownedProcessKills: number[] = [];
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(child, 'app-terminal-exit'),
    notifyRunStopped: () => { stopped += 1; },
    notifyRunFailed: () => { failed += 1; },
    killProcessTree: (processId) => { ownedProcessKills.push(processId); },
  });
  const run = spawn(supervisor, 'hello', {}, { send: (value) => sent.push(value) });
  const start = await peer.waitFor('session.start');
  const terminal = { kind: 'complete', provider: 'gjc', exitCode: 0 };

  peer.event('app-terminal-exit', start.id, 'turn.completed', { message: terminal });
  peer.status('app-terminal-exit', start.id, 4_242);
  peer.status('app-terminal-exit', start.id, null);
  child.emit('exit', 1);
  await run;

  assert.deepEqual(sent, [terminal]);
  assert.equal(stopped, 1);
  assert.equal(failed, 0);
  assert.deepEqual(ownedProcessKills, []);
});

test('graceful shutdown waits for the worker response then terminates its process tree', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  let stopped = 0;
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(child, 'app-shutdown'),
    notifyRunStopped: () => { stopped += 1; },
  });
  const run = spawn(supervisor, 'hello', {}, { send() {} });
  const start = await peer.waitFor('session.start');
  const shutdownPromise = supervisor.shutdown();
  const shutdown = await peer.waitFor('worker.shutdown');

  assert.equal(child.killed, false);
  peer.respond(start);
  peer.respond(shutdown);
  await Promise.all([run, shutdownPromise]);

  assert.equal(stopped, 1);
  assert.equal(child.killed, true);
  await assert.rejects(
    spawn(supervisor, 'too-late', {}, { send() {} }),
    /GJC worker failed/,
  );
});

test('shutdown waits for in-flight exit cleanup and propagates its failure', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  let rejectTermination!: (error: Error) => void;
  const termination = new Promise<void>((_resolve, reject) => {
    rejectTermination = reject;
  });
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(child),
    killTree: () => termination,
  });
  const run = spawn(supervisor, 'hello', {}, { send() {} });
  const start = await peer.waitFor('session.start');
  peer.respond(start);
  await run;

  const shutdownPromise = supervisor.shutdown();
  await peer.waitFor('worker.shutdown');
  child.emit('exit', 1);
  let settled = false;
  void shutdownPromise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(settled, false);
  rejectTermination(new Error('tree still alive'));
  await assert.rejects(shutdownPromise, /GJC worker failed/);
});
test('rejecting option enrichment settles a pre-request run as not_started', async () => {
  const child = new FakeChild();
  const peer = new FakePeer(child);
  replyToHandshake(peer);
  const supervisor = new GjcWorkerSupervisor({
    ...runtime(child),
    enrichOptions: async () => { throw new Error('configuration unavailable'); },
  });
  const run = supervisor.spawnRun({
    runId: 'enrichment-failure',
    appSessionId: 'app-enrichment',
    message: 'hello',
    writer: { send() {} },
  });
  await assert.rejects(run.started, /GJC worker failed/);
  assert.equal(await run.outcome, 'not_started');
  assert.equal(supervisor.isActive('enrichment-failure'), false);
});
test('production POSIX terminator waits for direct-child close and process-group absence', async () => {
  const child = spawnChild(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const processId = child.pid!;
  await killWorkerTree(child);
  assert.throws(
    () => process.kill(-processId, 0),
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH',
  );
});
test('Windows tree reaping is explicitly fail-closed while the v2 runtime is frozen', async () => {
  await assert.rejects(
    killWorkerTree(new FakeChild(), 'win32'),
    /unconfirmed on Windows/,
  );
});
