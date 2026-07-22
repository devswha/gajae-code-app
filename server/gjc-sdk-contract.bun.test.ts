import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { test } from 'node:test';

import { GjcBunSdkAdapter, createGjcBunSdkAdapter, type GjcAgentSessionFactory } from './gjc-bun-sdk-adapter.js';
import { GjcBunAskController } from './gjc-bun-ask-controller.js';
import { GJC_WORKER_PROTOCOL_VERSION, type GjcWorkerRequestFrame } from './gjc-worker-protocol.js';
import { GjcWorkerHost } from './gjc-worker.js';

type Listener = (event: unknown) => void;
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Scriptable SDK-shaped session; prompt owns the turn lifetime exactly as production does. */
class FakeAgentSession {
  readonly sessionFile = 'fake-session.jsonl';
  readonly promptStarted = deferred<void>();
  readonly abortStarted = deferred<void>();
  readonly #listeners = new Set<Listener>();
  readonly #prompt = deferred<void>();
  uiContext: { select(title: string, options: string[]): Promise<string | undefined> } | undefined;
  disposed = false;
  aborted = false;
  abortError: Error | undefined;
  neverSettleAbort = false;
  abortDeferred: Deferred<void> | undefined;
  disposeError: Error | undefined;

  subscribe(listener: Listener): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  setToolUIContext(context: typeof this.uiContext): void { this.uiContext = context; }
  async prompt(_message: string): Promise<void> { this.promptStarted.resolve(); return this.#prompt.promise; }
  async abort(): Promise<void> {
    this.abortStarted.resolve();
    if (this.neverSettleAbort) return new Promise<void>(() => {});
    if (this.abortError) throw this.abortError;
    await this.abortDeferred?.promise;
    this.aborted = true;
    this.#prompt.resolve();
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.disposeError) throw this.disposeError;
  }
  emit(event: unknown): void { for (const listener of this.#listeners) listener(event); }
  complete(): void { this.#prompt.resolve(); }
  fail(error = new Error('fake failure')): void { this.#prompt.reject(error); }
}

const request = (method: string, id: string, payload: Record<string, unknown> = {}, sessionId = 'contract-scope') => ({
  protocolVersion: GJC_WORKER_PROTOCOL_VERSION,
  kind: 'request' as const,
  id,
  method,
  payload,
  ...(['worker.initialize', 'worker.shutdown'].includes(method) ? {} : { sessionId }),
}) as GjcWorkerRequestFrame;

async function fixture(
  defaultModel = 'contract-model',
  modelProfile?: string,
  model = { id: 'contract-model', provider: 'contract-provider' },
) {
  const root = await mkdtemp(join(tmpdir(), 'gjc-contract-'));
  const sessions: FakeAgentSession[] = [];
  const factoryOptions: Array<Record<string, unknown>> = [];
  const authStorage = {
    credentials: [] as Array<{ id: number; provider: string }>,
    exportSnapshot() { return { credentials: this.credentials }; },
    setRuntimeApiKey: () => {},
    removeRuntimeApiKey: () => {},
  };
  const modelRegistry = {
    authStorage,
    getAll: () => [model],
    getModelProfile: () => undefined,
  };
  const factory = (async (input: Record<string, unknown>) => {
    factoryOptions.push(input);
    const session = new FakeAgentSession();
    sessions.push(session);
    return { session, setToolUIContext: session.setToolUIContext.bind(session) };
  }) as unknown as GjcAgentSessionFactory;
  const settings = {
    getModelRole: () => defaultModel || undefined,
    get: (key: string) => key === 'modelProfile.default' ? modelProfile : undefined,
    cloneForCwd: async () => ({ getModelRole: () => defaultModel || undefined }),
  };
  const adapter = new GjcBunSdkAdapter(authStorage as never, modelRegistry as never, {
    createSessionFactory: factory,
    settings: settings as never,
  });
  const frames: Array<Record<string, unknown>> = [];
  const host = new GjcWorkerHost({ runtime: async () => adapter, emit: (frame) => frames.push(frame as Record<string, unknown>) });
  await host.handle(request('worker.initialize', 'init'));
  const options = {
    cwd: process.cwd(),
    sessionRoot: root,
    credential: { kind: 'runtime-env', envVar: 'GJC_RUNTIME_API_KEY' },
    modelId: 'contract-model',
    toolNames: [],
    spawns: 'deny',
    bashPolicy: { allowedPrefixes: [] },
  };
  return { root, adapter, authStorage, factoryOptions, sessions, frames, host, options, close: () => rm(root, { recursive: true, force: true }) };
}

function methods(frames: Array<Record<string, unknown>>): string[] { return frames.filter((frame) => frame.kind === 'event').map((frame) => frame.method as string); }
function response(frames: Array<Record<string, unknown>>, id: string): Record<string, unknown> { return frames.find((frame) => frame.kind === 'response' && frame.id === id)!; }
async function firstSession(sessions: FakeAgentSession[]): Promise<FakeAgentSession> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (sessions[0]) return sessions[0];
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Fake session was not created.');
}
type ProductionWorkerResult = {
  frames: Array<Record<string, unknown>>;
  stderr: string;
  exitCode: number | null;
};

async function runProductionWorker(env: NodeJS.ProcessEnv = {}): Promise<ProductionWorkerResult> {
  const bun = join(process.cwd(), 'dist-native', 'bun');
  const worker = join(process.cwd(), 'server', 'gjc-bun-worker.ts');
  return new Promise((resolve, reject) => {
    const child = spawn(bun, [worker], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const frames: Array<Record<string, unknown>> = [];
    let stderr = '';
    let stdout = '';
    let initialized = false;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Production Bun worker timed out.'));
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split('\n');
      stdout = lines.pop()!;
      for (const line of lines) {
        if (line) frames.push(JSON.parse(line) as Record<string, unknown>);
      }
      const init = frames.find((frame) => frame.kind === 'response' && frame.id === 'entry-init');
      if (init && !initialized) {
        initialized = true;
        child.stdin.write(`${JSON.stringify(request('worker.shutdown', 'entry-shutdown'))}\n`);
        child.stdin.end();
      }
    });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({ frames, stderr, exitCode });
    });
    child.stdin.write(`${JSON.stringify(request('worker.initialize', 'entry-init'))}\n`);
  });
}

process.env.GJC_RUNTIME_API_KEY ??= 'contract-test-key';

test('golden protocol order: session, stream, tool, ask, usage, terminal, response', async () => {
  const f = await fixture();
  try {
    const run = f.host.handle(request('session.start', 'golden', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'one' } });
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'two' } });
    session.emit({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read', args: {} });
    session.emit({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read', result: 'ok' });
    const ask = session.uiContext!.select('Proceed?', ['Yes']);
    await Promise.resolve();
    const askFrame = f.frames.at(-1)!;
    const requestId = ((askFrame.payload as Record<string, unknown>).message as Record<string, unknown>).requestId as string;
    await f.host.handle(request('ask.reply', 'reply', { runId: 'golden', requestId, decision: { allow: true, message: 'Yes' } }));
    assert.equal(await ask, 'Yes');
    session.emit({ type: 'message_end', message: { role: 'assistant', content: [{ text: 'done' }], usage: { used: 4, total: 10 } } });
    session.complete();
    await run;
    assert.deepEqual(methods(f.frames), ['session.created', 'message.delta', 'message.delta', 'tool.started', 'tool.completed', 'ask.presented', 'message.completed', 'usage.updated', 'turn.completed', 'worker.status']);
    assert.equal(methods(f.frames).filter((method) => method === 'turn.completed').length, 1);
    assert.equal(response(f.frames, 'golden').payload instanceof Object, true);
  } finally { await f.close(); }
});

test('resume fails closed when the injected session root has no exact session file match', async () => {
  const f = await fixture();
  try {
    await f.host.handle(request('session.resume', 'resume-missing', { message: 'resume', options: f.options, providerSessionId: 'not-present' }));
    assert.equal(f.sessions.length, 0);
    assert.equal((response(f.frames, 'resume-missing').payload as Record<string, unknown>).ok, false);
    assert.equal(methods(f.frames).includes('session.created'), false);
  } finally { await f.close(); }
});
test('resume opens the sole exact session file and never re-emits session.created', async () => {
  const f = await fixture();
  try {
    const providerSessionId = 'exact-resume';
    await writeFile(join(f.root, 'only.jsonl'), `${JSON.stringify({
      type: 'session', version: 3, id: providerSessionId, timestamp: new Date().toISOString(), cwd: f.root,
    })}\n`);
    const run = f.host.handle(request('session.resume', 'resume-exact', {
      message: 'resume',
      options: f.options,
      providerSessionId,
    }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    session.complete();
    await run;
    assert.equal((f.factoryOptions[0]!.sessionManager as { getSessionId(): string }).getSessionId(), providerSessionId);
    assert.equal(methods(f.frames).includes('session.created'), false);
  } finally { await f.close(); }
});
test('sequential runs clone global settings for each cwd while retaining the session root', async () => {
  const f = await fixture();
  const firstCwd = await mkdtemp(join(tmpdir(), 'gjc-cwd-one-'));
  const secondCwd = await mkdtemp(join(tmpdir(), 'gjc-cwd-two-'));
  try {
    const first = f.host.handle(request('session.start', 'cwd-one', { message: 'one', options: { ...f.options, cwd: firstCwd } }));
    const firstRunSession = await firstSession(f.sessions);
    await firstRunSession.promptStarted.promise;
    firstRunSession.complete();
    await first;
    const second = f.host.handle(request('session.start', 'cwd-two', { message: 'two', options: { ...f.options, cwd: secondCwd } }));
    for (let attempt = 0; attempt < 100 && !f.sessions[1]; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    const secondSession = f.sessions[1]!;
    await secondSession.promptStarted.promise;
    secondSession.complete();
    await second;
    assert.equal(f.factoryOptions[0]!.cwd, firstCwd);
    assert.equal(f.factoryOptions[1]!.cwd, secondCwd);
    assert.notEqual(f.factoryOptions[0]!.settings, f.factoryOptions[1]!.settings);
    for (const factoryInput of f.factoryOptions) {
      const sessionFile = (factoryInput.sessionManager as { getSessionFile(): string | undefined }).getSessionFile();
      assert.ok(sessionFile);
      const relativeSessionFile = relative(f.root, sessionFile);
      assert.ok(relativeSessionFile && !relativeSessionFile.startsWith('..') && !isAbsolute(relativeSessionFile));
    }
  } finally {
    await Promise.all([f.close(), rm(firstCwd, { recursive: true, force: true }), rm(secondCwd, { recursive: true, force: true })]);
  }
});
test('default model role resolves deterministically and is reported in the start result', async () => {
  const f = await fixture();
  try {
    const run = f.host.handle(request('session.start', 'default-model', {
      message: 'hello',
      options: { ...f.options, modelId: 'default' },
    }));
    const session = await firstSession(f.sessions);
    session.complete();
    await run;
    assert.equal(f.factoryOptions[0]!.model && (f.factoryOptions[0]!.model as { id: string }).id, 'contract-model');
    assert.equal(((response(f.frames, 'default-model').payload as Record<string, unknown>).result as Record<string, unknown>).model, 'contract-model');
  } finally { await f.close(); }
});
test('default model role resolves its selector without the thinking suffix', async () => {
  const f = await fixture('openai-codex/gpt-5.6-sol:medium', undefined, {
    id: 'gpt-5.6-sol',
    provider: 'openai-codex',
  });
  try {
    const run = f.host.handle(request('session.start', 'default-model-role-suffix', {
      message: 'hello',
      options: { ...f.options, modelId: 'default' },
    }));
    const session = await firstSession(f.sessions);
    session.complete();
    await run;
    assert.equal(f.factoryOptions[0]!.model && (f.factoryOptions[0]!.model as { id: string }).id, 'gpt-5.6-sol');
    assert.equal(((response(f.frames, 'default-model-role-suffix').payload as Record<string, unknown>).result as Record<string, unknown>).model, 'gpt-5.6-sol');
  } finally { await f.close(); }
});
test('default model profile resolves its selector without the thinking suffix', async () => {
  const f = await fixture('', 'claude-fable', { id: 'claude-fable-5', provider: 'anthropic' });
  try {
    const run = f.host.handle(request('session.start', 'default-model-profile', {
      message: 'hello',
      options: { ...f.options, modelId: 'default' },
    }));
    const session = await firstSession(f.sessions);
    session.complete();
    await run;
    assert.equal(f.factoryOptions[0]!.model && (f.factoryOptions[0]!.model as { id: string }).id, 'claude-fable-5');
    assert.equal(((response(f.frames, 'default-model-profile').payload as Record<string, unknown>).result as Record<string, unknown>).model, 'claude-fable-5');
  } finally { await f.close(); }
});
test('default model role fails closed when settings do not configure it', async () => {
  const f = await fixture('');
  try {
    await f.host.handle(request('session.start', 'missing-default-model', {
      message: 'hello',
      options: { ...f.options, modelId: 'default' },
    }));
    assert.equal((response(f.frames, 'missing-default-model').payload as Record<string, unknown>).ok, false);
    assert.equal(f.sessions.length, 0);
  } finally { await f.close(); }
});
test('resume fails closed when multiple files claim the provider session id', async () => {
  const f = await fixture();
  try {
    const providerSessionId = 'ambiguous-resume';
    const sessionFile = join(f.root, 'first.jsonl');
    await writeFile(sessionFile, `${JSON.stringify({
      type: 'session', version: 3, id: providerSessionId, timestamp: new Date().toISOString(), cwd: f.root,
    })}\n`);
    await copyFile(sessionFile, join(f.root, 'duplicate.jsonl'));
    await f.host.handle(request('session.resume', 'resume-ambiguous', {
      message: 'resume',
      options: f.options,
      providerSessionId,
    }));
    assert.equal(f.sessions.length, 0);
    assert.equal((response(f.frames, 'resume-ambiguous').payload as Record<string, unknown>).ok, false);
  } finally { await f.close(); }
});

for (const phase of ['before-first-event', 'during-ask', 'vs-prompt-resolve'] as const) {
  test(`abort ${phase} emits no terminal and reports aborted only after SDK abort`, async () => {
    const f = await fixture();
    try {
      const run = f.host.handle(request('session.start', `abort-${phase}`, { message: 'hello', options: f.options }));
      const session = await firstSession(f.sessions);
      await session.promptStarted.promise;
      if (phase === 'during-ask') {
        void session.uiContext!.select('Wait?', ['Continue']).catch(() => {});
        await Promise.resolve();
      }
      const abort = f.host.handle(request('turn.abort', `abort-request-${phase}`, { runId: `abort-${phase}` }));
      await session.abortStarted.promise;
      if (phase === 'vs-prompt-resolve') session.complete();
      await abort;
      await run;
      const abortPayload = response(f.frames, `abort-request-${phase}`).payload as Record<string, unknown>;
      assert.deepEqual(abortPayload, { ok: true, result: { runId: `abort-${phase}`, aborted: true } });
      assert.equal(methods(f.frames).filter((method) => method === 'turn.completed' || method === 'turn.failed').length, 0);
      assert.equal(session.disposed, true);
    } finally { await f.close(); }
  });
}
test('failed SDK abort rolls back suppression and allows subsequent terminal events', async () => {
  const f = await fixture();
  try {
    const run = f.host.handle(request('session.start', 'abort-throws', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    session.abortError = new Error('abort failed');
    await f.host.handle(request('turn.abort', 'abort-throws-request', { runId: 'abort-throws' }));
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'still-live' } });
    session.complete();
    await run;
    assert.deepEqual((response(f.frames, 'abort-throws-request').payload as Record<string, unknown>).result, { runId: 'abort-throws', aborted: false });
    assert.ok(methods(f.frames).includes('message.delta'));
    assert.ok(methods(f.frames).includes('turn.completed'));
    // A rejected abort leaves the run active; its successful completion must
    // settle the start response as ok, not run_failed.
    assert.equal((response(f.frames, 'abort-throws').payload as Record<string, unknown>).ok, true);
  } finally { await f.close(); }
});
test('failed SDK abort keeps pending and subsequent asks available', async () => {
  const f = await fixture();
  try {
    const run = f.host.handle(request('session.start', 'abort-ask-throws', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    session.abortError = new Error('abort failed');
    const pending = session.uiContext!.select('First?', ['Yes']);
    await Promise.resolve();
    const firstRequestId = (((f.frames.at(-1)!.payload as Record<string, unknown>).message as Record<string, unknown>).requestId as string);
    await f.host.handle(request('turn.abort', 'abort-ask-throws-request', { runId: 'abort-ask-throws' }));
    await f.host.handle(request('ask.reply', 'first-after-abort', { runId: 'abort-ask-throws', requestId: firstRequestId, decision: { allow: true, message: 'Yes' } }));
    assert.equal(await pending, 'Yes');
    const subsequent = session.uiContext!.select('Second?', ['No']);
    await Promise.resolve();
    const secondRequestId = (((f.frames.at(-1)!.payload as Record<string, unknown>).message as Record<string, unknown>).requestId as string);
    await f.host.handle(request('ask.reply', 'second-after-abort', { runId: 'abort-ask-throws', requestId: secondRequestId, decision: { allow: true, message: 'No' } }));
    assert.equal(await subsequent, 'No');
    session.complete();
    await run;
  } finally { await f.close(); }
});

test('never-settling abort is bounded after the prompt settles', async () => {
  const f = await fixture();
  try {
    const frames: Array<Record<string, unknown>> = [];
    const host = new GjcWorkerHost({ runtime: async () => f.adapter, emit: (frame) => frames.push(frame as Record<string, unknown>), closeDrainMs: 10 });
    await host.handle(request('worker.initialize', 'bounded-init'));
    const run = host.handle(request('session.start', 'bounded-abort', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    session.neverSettleAbort = true;
    const abort = host.handle(request('turn.abort', 'bounded-abort-request', { runId: 'bounded-abort' }));
    await session.abortStarted.promise;
    session.complete();
    await Promise.all([abort, run]);
    assert.equal((response(frames, 'bounded-abort').payload as Record<string, unknown>).ok, false);
    assert.equal((response(frames, 'bounded-abort-request').payload as Record<string, unknown>).ok, false);
  } finally { await f.close(); }
});
test('late SDK abort resolution after the deadline cannot turn a failed run into an aborted success', async () => {
  const f = await fixture();
  try {
    const frames: Array<Record<string, unknown>> = [];
    const host = new GjcWorkerHost({ runtime: async () => f.adapter, emit: (frame) => frames.push(frame as Record<string, unknown>), closeDrainMs: 10 });
    await host.handle(request('worker.initialize', 'late-abort-init'));
    const run = host.handle(request('session.start', 'late-abort', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    session.abortDeferred = deferred<void>();
    const abort = host.handle(request('turn.abort', 'late-abort-request', { runId: 'late-abort' }));
    await session.abortStarted.promise;
    session.complete();
    await new Promise((resolve) => setTimeout(resolve, 20));
    session.abortDeferred.resolve();
    await Promise.all([abort, run]);
    assert.equal((response(frames, 'late-abort').payload as Record<string, unknown>).ok, false);
    assert.equal((response(frames, 'late-abort-request').payload as Record<string, unknown>).ok, false);
    assert.equal(JSON.stringify(frames).includes('"aborted":true'), false);
  } finally { await f.close(); }
});
test('rejecting session disposal emits the fixed diagnostic and fails the run', async () => {
  const f = await fixture();
  const originalError = console.error;
  const diagnostics: unknown[][] = [];
  console.error = (...args: unknown[]) => { diagnostics.push(args); };
  try {
    const run = f.host.handle(request('session.start', 'dispose-rejects', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    session.disposeError = new Error('dispose failed');
    session.complete();
    await run;
    assert.equal((response(f.frames, 'dispose-rejects').payload as Record<string, unknown>).ok, false);
    assert.deepEqual(diagnostics, [['GJC SDK session disposal failed.']]);
  } finally {
    console.error = originalError;
    await f.close();
  }
});

test('explicit SDK configuration rejects missing fields, unresolvable credentials, and model mismatches without invoking the factory', async () => {
  const f = await fixture();
  try {
    const invalid = [
      (() => { const { spawns: _spawns, ...missing } = f.options; return missing; })(),
      { ...f.options, credential: { kind: 'stored', providerId: 'wrong-provider' } },
      { ...f.options, credential: { kind: 'stored', credentialId: 999 } },
      { ...f.options, modelId: 'unregistered-model' },
    ];
    f.authStorage.credentials = [
      { id: 2, provider: 'contract-provider' },
      { id: 7, provider: 'contract-provider' },
    ];
    for (const [index, options] of invalid.entries()) {
      await f.host.handle(request('session.start', `invalid-${index}`, { message: 'x', options }));
      assert.equal((response(f.frames, `invalid-${index}`).payload as Record<string, unknown>).ok, false);
    }
    assert.equal(f.sessions.length, 0);
    // Zero stored rows for the model provider stays fail-closed.
    f.authStorage.credentials = [];
    await f.host.handle(request('session.start', 'invalid-zero-rows', { message: 'x', options: { ...f.options, credential: { kind: 'stored' } } }));
    assert.equal((response(f.frames, 'invalid-zero-rows').payload as Record<string, unknown>).ok, false);
    assert.equal(f.sessions.length, 0);
    // Multiple stored rows resolve deterministically to the lowest row id.
    f.authStorage.credentials = [
      { id: 7, provider: 'contract-provider' },
      { id: 2, provider: 'contract-provider' },
    ];
    const run = f.host.handle(request('session.start', 'stored-deterministic', { message: 'x', options: { ...f.options, credential: { kind: 'stored' } } }));
    const session = await firstSession(f.sessions);
    session.complete();
    await run;
    const factoryInput = f.factoryOptions.at(-1) as { credentialSelector?: { selector: { value: string } } };
    assert.equal(factoryInput.credentialSelector?.selector.value, '2');
    assert.deepEqual(((response(f.frames, 'stored-deterministic').payload as Record<string, unknown>).result as Record<string, unknown>).credential, {
      kind: 'stored',
      providerId: 'contract-provider',
      credentialId: 2,
    });
  } finally { await f.close(); }
});

test('ask bridge rejects duplicate and stale replies and cancels pending permission on dispose', async () => {
  const f = await fixture();
  try {
    const run = f.host.handle(request('session.start', 'ask-contract', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    const pending = session.uiContext!.select('Choose', ['One']);
    await Promise.resolve();
    const askFrame = f.frames.at(-1)!;
    const requestId = (((askFrame.payload as Record<string, unknown>).message as Record<string, unknown>).requestId as string);
    await f.host.handle(request('ask.reply', 'answerless-reply', { runId: 'ask-contract', requestId, decision: { allow: true } }));
    assert.deepEqual((response(f.frames, 'answerless-reply').payload as Record<string, unknown>).result, { runId: 'ask-contract', accepted: false });
    await f.host.handle(request('ask.reply', 'first-reply', { runId: 'ask-contract', requestId, decision: { allow: true, message: 'One' } }));
    await pending;
    await f.host.handle(request('ask.reply', 'duplicate-reply', { runId: 'ask-contract', requestId, decision: { allow: true } }));
    assert.deepEqual((response(f.frames, 'duplicate-reply').payload as Record<string, unknown>).result, { runId: 'ask-contract', accepted: false });
    const stale = session.uiContext!.select('Stale', ['No']);
    await Promise.resolve();
    await f.host.handle(request('turn.abort', 'abort-ask', { runId: 'ask-contract' }));
    await assert.rejects(stale, /GJC ask request cancelled/);
    await run;
    assert.equal(methods(f.frames).filter((method) => method === 'ask.presented').length, 3);
  } finally { await f.close(); }
});
test('ask dialogs cancel on AbortSignal and timeout after invoking onTimeout', async () => {
  const messages: Array<Record<string, unknown>> = [];
  const controller = new GjcBunAskController({ send: (message) => messages.push(message as Record<string, unknown>) });
  const signal = new AbortController();
  const aborted = controller.uiContext.select('Abort', ['No'], { signal: signal.signal });
  signal.abort();
  await assert.rejects(aborted, /GJC ask request cancelled/);
  let timedOut = false;
  const timeout = controller.uiContext.select('Timeout', ['No'], {
    timeout: 1,
    onTimeout: () => { timedOut = true; },
  });
  await assert.rejects(timeout, /GJC ask request cancelled/);
  assert.equal(timedOut, true);
  assert.equal(messages.filter((message) => message.kind === 'permission_cancelled').length, 2);
});
test('production Bun worker verifies the manifest before accepting initialize and shuts down over stdio', async () => {
  const agentDirectory = await mkdtemp(join(tmpdir(), 'gjc-agent-'));
  try {
    const result = await runProductionWorker({
      GJC_ALLOW_RUNTIME_MANIFEST_OVERRIDE: undefined,
      GJC_RUNTIME_MANIFEST_PATH: undefined,
      GJC_WORKER_AGENT_DIR: agentDirectory,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual((response(result.frames, 'entry-init').payload as Record<string, unknown>).ok, true);
    assert.deepEqual((response(result.frames, 'entry-shutdown').payload as Record<string, unknown>).ok, true);
  } finally {
    await rm(agentDirectory, { recursive: true, force: true });
  }
});

test('production Bun worker rejects a tampered test-only manifest override', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gjc-manifest-'));
  const manifestPath = join(directory, 'gjc-runtime-manifest.json');
  try {
    const manifest = JSON.parse(await readFile(join(process.cwd(), 'server', 'gjc-runtime-manifest.json'), 'utf8')) as {
      platforms: Record<string, { files: Array<{ sha256: string }> }>;
    };
    manifest.platforms[`${process.platform}-${process.arch}`]!.files[0]!.sha256 = '0'.repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest));
    const agentDirectory = await mkdtemp(join(directory, 'agent-'));
    const result = await runProductionWorker({
      GJC_ALLOW_RUNTIME_MANIFEST_OVERRIDE: '1',
      GJC_RUNTIME_MANIFEST_PATH: manifestPath,
      GJC_WORKER_AGENT_DIR: agentDirectory,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /GJC runtime manifest override enabled/);
    const payload = response(result.frames, 'entry-init').payload as Record<string, unknown>;
    assert.equal(payload.ok, false);
    assert.deepEqual((payload.error as Record<string, unknown>).code, 'initialization_failed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('live pinned SDK smoke (set GJC_CONTRACT_LIVE=1)', { skip: process.env.GJC_CONTRACT_LIVE === '1' ? false : 'requires GJC_CONTRACT_LIVE=1' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'gjc-contract-live-'));
  try {
    const modelId = process.env.GJC_CONTRACT_LIVE_MODEL_ID;
    assert.ok(modelId, 'GJC_CONTRACT_LIVE_MODEL_ID is required for the live smoke');
    // Credential ref: "stored:<providerId>" uses the machine's real AuthStorage
    // row (the production shape); default stays runtime-env for CI safety.
    const credentialSpec = process.env.GJC_CONTRACT_LIVE_CREDENTIAL ?? 'runtime-env:GJC_RUNTIME_API_KEY';
    const credential = credentialSpec.startsWith('stored:')
      ? { kind: 'stored', providerId: credentialSpec.slice('stored:'.length) }
      : { kind: 'runtime-env', envVar: credentialSpec.slice('runtime-env:'.length) };
    const adapter = await createGjcBunSdkAdapter();
    const frames: Array<Record<string, unknown>> = [];
    const host = new GjcWorkerHost({ runtime: async () => adapter, emit: (frame) => frames.push(frame as Record<string, unknown>) });
    await host.handle(request('worker.initialize', 'live-init'));
    const options = {
      cwd: process.cwd(),
      sessionRoot: root,
      credential,
      modelId,
      toolNames: [],
      spawns: 'deny',
      bashPolicy: { allowedPrefixes: [] },
    };
    await host.handle(request('session.start', 'live-prompt', { message: 'Reply with the single word: ready', options }));
    assert.ok(methods(frames).includes('session.created'));
    assert.ok(methods(frames).includes('usage.updated'));
    assert.ok(methods(frames).includes('turn.completed'));

    const abortRun = host.handle(request('session.start', 'live-abort', { message: 'Think carefully for a long time before replying.', options }));
    for (let attempt = 0; attempt < 100 && methods(frames).filter((method) => method === 'session.created').length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await host.handle(request('turn.abort', 'live-abort-request', { runId: 'live-abort' }));
    await abortRun;
    assert.deepEqual((response(frames, 'live-abort-request').payload as Record<string, unknown>).result, { runId: 'live-abort', aborted: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
