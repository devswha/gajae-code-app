/**
 * Deterministic reproduction fixtures for the native-client failure path.
 *
 * Every case here uses an injected fake spawn: no real `gajae-core` process is
 * started, no real process is signalled or killed, and nothing depends on a
 * developer's machine state.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { GjcNativeClient, GjcNativeRequestError } from './gjc-git-client.js';
import { GjcJobsClient, GjcJobsClientError } from './gjc-jobs-client.js';
import {
  GjcNativeUnavailableError,
  NativeDiagnostics,
  errorCode,
  redactPaths,
} from './gjc-native-diagnostics.js';

const FAILURE = 'GJC native client is unavailable.';

type Listener = (...args: unknown[]) => void;

/** A fake child process. It owns no OS resources and kills nothing. */
class FakeChild {
  readonly listeners = new Map<string, Listener[]>();
  readonly stdoutListeners: Listener[] = [];
  readonly stderrListeners: Listener[] = [];
  readonly written: string[] = [];
  killed = 0;
  writeThrows = false;

  stdin = {
    write: (data: string) => {
      if (this.writeThrows) throw new Error('EPIPE');
      this.written.push(data);
      return true;
    },
    end: () => {},
    on: (event: string, listener: Listener) => this.add(event, listener),
  };
  stdout = { on: (_event: 'data', listener: Listener) => { this.stdoutListeners.push(listener); } };
  stderr = { on: (_event: 'data', listener: Listener) => { this.stderrListeners.push(listener); } };

  kill(): boolean {
    this.killed += 1;
    return true;
  }

  on(event: string, listener: Listener): unknown {
    return this.add(event, listener);
  }

  private add(event: string, listener: Listener): unknown {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }

  emitStdout(text: string): void {
    for (const listener of [...this.stdoutListeners]) listener(Buffer.from(text));
  }

  emitStderr(text: string): void {
    for (const listener of [...this.stderrListeners]) listener(Buffer.from(text));
  }
}

const options = (spawn: unknown, extra: Record<string, unknown> = {}) => ({
  corePath: '/fake/dist-native/gajae-core',
  spawn: spawn as never,
  environment: {},
  compiled: false,
  readyTimeoutMs: 25,
  restartDelayMs: 5,
  maxRestartDelayMs: 5,
  ...extra,
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The client unrefs every timer so it can never hold a server open. Tests that
 * wait for a timer-driven transition must keep the loop alive themselves.
 */
const keepAlive = (t: { after(fn: () => void): void }) => {
  const timer = setInterval(() => {}, 5);
  t.after(() => clearInterval(timer));
};

test('fixture: native client spawn failure keeps errno evidence behind the generic message', async (t) => {
  keepAlive(t);
  const client = new GjcNativeClient('git', options(() => {
    const error: NodeJS.ErrnoException = new Error('spawn /fake/dist-native/gajae-core ENOENT');
    error.code = 'ENOENT';
    throw error;
  }));
  const failure = await client.start().then(() => null, (error: unknown) => error);
  client.close();

  assert.ok(failure instanceof GjcNativeUnavailableError);
  // The historical message is load-bearing for GjcJobsClient classification.
  assert.equal((failure as Error).message, FAILURE);
  assert.equal(failure.category, 'spawn_failed');
  const spawnFailed = failure.evidence.filter((event) => event.stage === 'spawn_failed');
  assert.equal(spawnFailed.length, 1);
  assert.equal(spawnFailed[0].detail, 'ENOENT');
  assert.equal(spawnFailed[0].command, 'git');
});

test('fixture: native client readiness timeout is distinguishable from a spawn failure', async (t) => {
  keepAlive(t);
  const children: FakeChild[] = [];
  const client = new GjcNativeClient('git', options(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  }));
  // The child starts fine and simply never sends its `ready` frame.
  const failure = await client.start().then(() => null, (error: unknown) => error);
  client.close();

  assert.ok(failure instanceof GjcNativeUnavailableError);
  assert.equal((failure as Error).message, FAILURE);
  assert.equal(failure.category, 'ready_timeout');
  assert.equal(children.length, 1);
  const stages = failure.evidence.map((event) => event.stage);
  assert.deepEqual(stages.slice(0, 2), ['spawn', 'ready_timeout']);
  const timeout = failure.evidence.find((event) => event.stage === 'ready_timeout');
  assert.equal(timeout?.detail, 'afterMs=25');
});

test('fixture: a native child exit records its code and signal, not just unavailability', async (t) => {
  keepAlive(t);
  const children: FakeChild[] = [];
  const client = new GjcNativeClient('git', options(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  }));
  const starting = client.start().then(() => null, (error: unknown) => error);
  await settled();
  children[0].emit('exit', null, 'SIGSEGV');
  const failure = await starting;
  client.close();

  assert.ok(failure instanceof GjcNativeUnavailableError);
  assert.equal(failure.category, 'exit');
  const exit = failure.evidence.find((event) => event.stage === 'exit');
  assert.equal(exit?.detail, 'code=null signal=SIGSEGV');
});

test('fixture: native stderr is preserved but filesystem paths are redacted', async (t) => {
  keepAlive(t);
  const children: FakeChild[] = [];
  const client = new GjcNativeClient('git', options(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  }));
  const starting = client.start().then(() => null, (error: unknown) => error);
  await settled();
  children[0].emitStderr("thread 'main' panicked at /Users/someone/private/repo/src/git.rs:12: bad ref\n");
  const failure = await starting;
  client.close();

  assert.ok(failure instanceof GjcNativeUnavailableError);
  const stderr = failure.evidence.find((event) => event.stage === 'stderr');
  assert.ok(stderr, 'native stderr must no longer be discarded');
  assert.match(stderr.detail ?? '', /panicked at <path>/u);
  assert.ok(!stderr.detail?.includes('/Users/'), 'absolute paths must not be retained');
  assert.ok(!stderr.detail?.includes('someone'), 'path segments must not be retained');
});

test('fixture: repeated restart attempts stay individually attributable and stay bounded', async (t) => {
  keepAlive(t);
  const children: FakeChild[] = [];
  const client = new GjcNativeClient('git', options(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  }));
  void client.start().catch(() => {});
  // Let the readiness timeout fire repeatedly; each pass is one restart.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const evidence = client.evidence();
  client.close();

  const generations = new Set(evidence.map((event) => event.generation));
  assert.ok(children.length >= 3, `expected repeated restarts, saw ${children.length}`);
  assert.ok(generations.size >= 3, 'each restart must carry its own generation');
  assert.ok(evidence.length <= 32, 'evidence must stay bounded');
  const restarts = evidence.filter((event) => event.stage === 'restart_scheduled');
  assert.ok(restarts.length >= 1);
  assert.equal(restarts[0].detail, 'afterMs=5');
  // No real process was ever signalled; kills only reached the fakes.
  assert.ok(children.every((child) => child.killed >= 0));
});

test('fixture: an invalid protocol frame is recorded as a protocol failure', async (t) => {
  keepAlive(t);
  const children: FakeChild[] = [];
  const client = new GjcNativeClient('git', options(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  }));
  const starting = client.start().then(() => null, (error: unknown) => error);
  await settled();
  children[0].emitStdout('not json at all\n');
  const failure = await starting;
  client.close();

  assert.ok(failure instanceof GjcNativeUnavailableError);
  assert.equal(failure.category, 'protocol_error');
  const protocolError = failure.evidence.find((event) => event.stage === 'protocol_error');
  assert.equal(protocolError?.detail, 'frame_rejected');
});

test('the jobs client keeps its exact message and code while carrying the evidence', async (t) => {
  keepAlive(t);
  const client = new GjcJobsClient({
    database: '/fake/jobs.db',
    ...options(() => {
      const error: NodeJS.ErrnoException = new Error('spawn EACCES');
      error.code = 'EACCES';
      throw error;
    }),
  });
  const failure = await client.list().then(() => null, (error: unknown) => error);
  client.close();

  assert.ok(failure instanceof GjcJobsClientError);
  assert.equal(failure.message, FAILURE, 'the classified message must not change');
  assert.equal(failure.code, 'authority_unavailable');
  const cause = (failure as { cause?: unknown }).cause;
  assert.ok(cause instanceof GjcNativeUnavailableError, 'evidence must survive the rethrow');
  assert.equal(cause.category, 'spawn_failed');
  assert.equal(cause.evidence.at(-1)?.detail, 'EACCES');
  assert.ok(!(failure instanceof GjcNativeRequestError));
});

test('path redaction covers posix and windows paths without eating ordinary prose', () => {
  assert.equal(redactPaths('opened /Users/someone/.gajae-app/jobs.db'), 'opened <path>');
  assert.equal(redactPaths('opened C:\\\\Users\\\\someone\\\\jobs.db'), 'opened <path>');
  assert.equal(redactPaths('no path here at all'), 'no path here at all');
  assert.equal(redactPaths('ratio 3/4 and a/b'), 'ratio 3/4 and a/b');
});

test('error codes are reduced to enumerated identifiers only', () => {
  const errno: NodeJS.ErrnoException = new Error('boom');
  errno.code = 'ENOENT';
  assert.equal(errorCode(errno), 'ENOENT');
  assert.equal(errorCode(new TypeError('secret token abc')), 'TypeError');
  assert.equal(errorCode(new Error('secret token abc')), 'unknown');
  assert.equal(errorCode({ code: 'not a code; leaks /Users/x' }), 'unknown');
  assert.equal(errorCode(null), 'unknown');
});

test('the evidence ring keeps the newest records and never grows without bound', () => {
  const diagnostics = new NativeDiagnostics('jobs');
  for (let index = 0; index < 100; index += 1) diagnostics.record('spawn', index);
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.length, 32);
  assert.equal(snapshot.at(-1)?.generation, 99, 'the newest failure must survive');
  assert.equal(snapshot[0].generation, 68);
  assert.equal(diagnostics.category(), 'none');
  diagnostics.record('ready_timeout', 99);
  assert.equal(diagnostics.category(), 'ready_timeout');
  assert.ok(diagnostics.hasFailure(99));
  assert.ok(!diagnostics.hasFailure(98));
});

test('detail text is truncated so evidence cannot be used as a content channel', () => {
  const diagnostics = new NativeDiagnostics('git');
  diagnostics.record('stderr', 1, 'x'.repeat(5000));
  assert.equal(diagnostics.snapshot()[0].detail?.length, 200);
});
