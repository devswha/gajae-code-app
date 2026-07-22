import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  GJC_WORKER_PROTOCOL_VERSION,
  GjcWorkerNdjsonDecoder,
  parseGjcWorkerFrame,
  serializeGjcWorkerFrame,
  type GjcWorkerRequestFrame,
} from './gjc-worker-protocol.js';
import { GjcWorkerHost, runGjcWorkerEntrypoint, type GjcWorkerRuntime, type GjcWorkerWriter } from './gjc-worker.js';

const request = (method: string, id: string, payload: Record<string, unknown> = {}, sessionId = 'scope-1') => ({ protocolVersion: GJC_WORKER_PROTOCOL_VERSION, kind: 'request' as const, id, method, payload, ...(['worker.initialize', 'worker.shutdown'].includes(method) ? {} : { sessionId }) }) as GjcWorkerRequestFrame;
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fakeRuntime() {
  const runs: Array<{ run: ReturnType<typeof deferred<void>>; writer?: GjcWorkerWriter }> = []; const calls: string[] = [];
  const runtime: GjcWorkerRuntime = {
    spawnGjc: (_message, _options, writer) => {
      const run = deferred<void>();
      runs.push({ run, writer });
      const result = run.promise as Promise<void> & {
        abortHandle?: string;
        processId?: number;
      };
      result.abortHandle = `abort-${runs.length}`;
      result.processId = 4_200 + runs.length;
      return result;
    },
    abortGjcSession: async (id) => { calls.push(id); return true; },
    resolveGjcToolApproval: (id) => { calls.push(id); return true; },
  };
  return { runtime, runs, calls };
}
async function initialized(fake = fakeRuntime()) {
  const frames: unknown[] = []; const host = new GjcWorkerHost({ runtime: async () => fake.runtime, emit: (frame) => frames.push(frame) });
  await host.handle(request('worker.initialize', 'init'));
  return { fake, frames, host };
}

test('requires initialization exactly once and completes the handshake', async () => {
  const fake = fakeRuntime(); const frames: unknown[] = []; const host = new GjcWorkerHost({ runtime: async () => fake.runtime, emit: (frame) => frames.push(frame) });
  await host.handle(request('turn.start', 'early', { message: 'x', options: {} }));
  await host.handle(request('worker.initialize', 'init')); await host.handle(request('worker.initialize', 'again'));
  assert.equal((frames[0] as { payload: { error: { code: string } } }).payload.error.code, 'not_initialized');
  assert.equal((frames[1] as { payload: { ok: boolean } }).payload.ok, true);
  assert.equal((frames[2] as { payload: { error: { code: string } } }).payload.error.code, 'already_initialized');
});

test('validates start and resume payloads before invoking GJC', async () => {
  const { host, frames, fake } = await initialized();
  await host.handle(request('session.start', 'bad-start', { message: 1, options: {} }));
  await host.handle(request('session.resume', 'bad-resume', { message: 'x', options: {} }));
  assert.equal(fake.runs.length, 0);
  assert.equal((frames[1] as { payload: { error: { code: string } } }).payload.error.code, 'invalid_payload');
  assert.equal((frames[2] as { payload: { error: { code: string } } }).payload.error.code, 'invalid_payload');
});

test('maps events with immutable run identity and captures provider sessions', async () => {
  const { fake, host, frames } = await initialized();
  const pending = host.handle(request('session.start', 'run-1', { message: 'hello', options: {} })); await Promise.resolve();
  const writer = fake.runs[0].writer!;
  writer.setSessionId!('provider-1'); writer.send({ kind: 'stream_delta', content: 'hi' }); writer.send({ kind: 'tool_use' }); writer.send({ kind: 'tool_result' }); writer.send({ kind: 'permission_request' }); writer.send({ kind: 'status', text: 'token_budget' }); writer.send({ kind: 'complete', exitCode: 0 });
  const events = frames.slice(1) as Array<{ method: string; payload: { runId: string } }>;
  assert.deepEqual(events.map((frame) => frame.method), ['worker.status', 'session.created', 'message.delta', 'tool.started', 'tool.completed', 'ask.presented', 'usage.updated', 'turn.completed']);
  assert.ok(events.every((frame) => frame.payload.runId === 'run-1'));
  fake.runs[0].run.resolve();
  await pending;
  const tail = frames.slice(-2) as Array<{
    kind: string;
    method: string;
    payload: { processId?: number | null };
  }>;
  assert.equal(tail[0]?.method, 'worker.status');
  assert.equal(tail[0]?.payload.processId, null);
  assert.equal(tail[1]?.kind, 'response');
});

test('allows overlapping app scopes while routing abort and approval by exact runId', async () => {
  const { fake, host, frames } = await initialized();
  const first = host.handle(request('turn.start', 'run-old', { message: 'old', options: {} }));
  const second = host.handle(request('turn.start', 'run-new', { message: 'new', options: {} })); await Promise.resolve();
  await host.handle(request('turn.abort', 'abort', { runId: 'run-old' }));
  await host.handle(request('ask.reply', 'reply', { runId: 'run-new', requestId: 'ask-2', decision: { allow: true } }));
  assert.deepEqual(fake.calls, ['abort-1', 'ask-2']);
  assert.equal((frames.at(-2) as { payload: { result: { runId: string } } }).payload.result.runId, 'run-old');
  fake.runs[0].run.resolve(); fake.runs[1].run.resolve(); await Promise.all([first, second]);
});

test('isolates late old-run events and rejects duplicate run IDs', async () => {
  const { fake, host, frames } = await initialized();
  const first = host.handle(request('turn.start', 'run-same', { message: 'old', options: {} })); await Promise.resolve();
  const oldWriter = fake.runs[0].writer!;
  await host.handle(request('turn.start', 'run-same', { message: 'duplicate', options: {} }));
  assert.equal((frames.at(-1) as { payload: { error: { code: string } } }).payload.error.code, 'duplicate_run_id');
  fake.runs[0].run.resolve(); await first;
  const count = frames.length; oldWriter.send({ kind: 'stream_delta', content: 'late' });
  assert.equal(frames.length, count);
});

test('close drains active runs, shutdown responds only after abort drain, and post-shutdown work fails safely', async () => {
  const { fake, host, frames } = await initialized();
  const pending = host.handle(request('turn.start', 'run-close', { message: 'hello', options: {} })); await Promise.resolve();
  const shutdown = host.handle(request('worker.shutdown', 'shutdown'));
  await Promise.resolve();
  assert.deepEqual(fake.calls, ['abort-1']);
  assert.equal(frames.some((frame) => (frame as { id: string }).id === 'shutdown'), false);
  fake.runs[0].run.resolve(); await Promise.all([pending, shutdown]);
  assert.equal((frames.find((frame) => (frame as { id: string }).id === 'shutdown') as { payload: { ok: boolean } }).payload.ok, true);
  await host.handle(request('ask.reply', 'after', { runId: 'run-close', requestId: 'ask', decision: true }));
  assert.equal((frames.at(-1) as { payload: { error: { code: string } } }).payload.error.code, 'worker_closed');
});

test('close bounds the abort phase when a runtime abort never settles', async () => {
  const fake = fakeRuntime();
  fake.runtime.abortGjcSession = async () => new Promise<boolean>(() => {});
  const frames: unknown[] = [];
  const host = new GjcWorkerHost({
    runtime: async () => fake.runtime,
    emit: (frame) => frames.push(frame),
    closeDrainMs: 5,
  });
  await host.handle(request('worker.initialize', 'init'));
  const pending = host.handle(request('turn.start', 'run-hung-abort', {
    message: 'hello',
    options: {},
  }));
  await Promise.resolve();

  const result = await Promise.race([
    host.close().then(() => 'closed'),
    new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
  ]);
  assert.equal(result, 'closed');

  fake.runs[0].run.resolve();
  await pending;
});

test('returns safe run failures without raw runtime text', async () => {
  const { fake, host, frames } = await initialized();
  const pending = host.handle(request('turn.start', 'run-fail', { message: 'hello', options: {} })); await Promise.resolve();
  fake.runs[0].run.reject(new Error('super-secret stderr /cwd argv')); await pending;
  const text = JSON.stringify(frames);
  assert.ok(text.includes('GJC run failed.') && !text.includes('super-secret'));
});

test('entrypoint fails closed on malformed input and emits protocol-only stdout', async () => {
  const previousExitCode = process.exitCode;
  try {
    const input = new PassThrough(); const output = new PassThrough(); const errors = new PassThrough(); let stdout = ''; let stderr = '';
    output.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); }); errors.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    runGjcWorkerEntrypoint(input, output, errors);
    input.end('{not json}\n'); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stdout, ''); assert.equal(stderr.includes('GJC worker protocol failure.'), true);
    assert.doesNotThrow(() => stdout.split('\n').filter(Boolean).forEach((line) => parseGjcWorkerFrame(line)));
  } finally { process.exitCode = previousExitCode; }
});

test('production worker executable performs a protocol-only handshake and shutdown', async (t) => {
  const workerPath = fileURLToPath(new URL('./gjc-worker.ts', import.meta.url));
  const tsconfigPath = fileURLToPath(new URL('./tsconfig.json', import.meta.url));
  const child = spawn(process.execPath, ['--import', 'tsx', workerPath], {
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: tsconfigPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });

  const decoder = new GjcWorkerNdjsonDecoder();
  const frames: ReturnType<typeof parseGjcWorkerFrame>[] = [];
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    frames.push(...decoder.push(chunk));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const initialize = request('worker.initialize', 'process-init');
  child.stdin.write(serializeGjcWorkerFrame(initialize));
  for (let attempt = 0; attempt < 500 && frames.length < 1; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(frames[0]?.kind, 'response');
  assert.equal((frames[0] as { payload?: { ok?: boolean } }).payload?.ok, true);

  const shutdown = request('worker.shutdown', 'process-shutdown');
  child.stdin.write(serializeGjcWorkerFrame(shutdown));
  for (let attempt = 0; attempt < 500 && frames.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((frames[1] as { payload?: { ok?: boolean } }).payload?.ok, true);
  child.stdin.end();

  for (let attempt = 0; attempt < 500 && child.exitCode === null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(child.exitCode, 0);
  assert.equal(stderr, '');
});
