import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { test } from 'node:test';

import { ACP_BUILTIN_SLASH_COMMANDS } from '@gajae-code/coding-agent/slash-commands/acp-builtins';


import {
  GJC_APP_BUILTIN_COMMANDS,
  GJC_APP_BUILTIN_COMMAND_ALIASES,
  GJC_APP_BUILTIN_COMMAND_NAMES,
} from './gjc-command-surface.generated.js';
import {
  GjcBunSdkAdapter,
  createGjcBunSdkAdapter,
  ensureSdkThemeInitialized,
  type GjcAgentSessionFactory,
  type GjcBunSdkAdapterOptions,
} from './gjc-bun-sdk-adapter.js';
import { GjcBunAskController } from './gjc-bun-ask-controller.js';
import {
  GJC_WORKER_PROTOCOL_VERSION,
  parseGjcWorkerFrame,
  type GjcWorkerRequestFrame,
} from './gjc-worker-protocol.js';
import { GjcWorkerHost } from './gjc-worker.js';

type Listener = (event: unknown) => void;
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type OAuthCallbacks = {
  onAuth(info: { url: string; instructions?: string }): void;
  onProgress?(message: string): void;
  onManualCodeInput?(): Promise<string>;
  onPrompt(prompt: { message: string; placeholder?: string }): Promise<string>;
  signal?: AbortSignal;
};
type OAuthLogin = (provider: string, callbacks: OAuthCallbacks) => Promise<void>;

const globalMethods = new Set([
  'worker.initialize',
  'worker.shutdown',
  'models.catalog',
  'oauth.providers',
  'oauth.status',
  'oauth.start',
  'oauth.submit',
  'oauth.cancel',
]);

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Expected value was not observed.');
}

/**
 * The catalog is generated from the installed runtime, so the thing worth
 * asserting is no longer "does the list match" — the prebuild check enforces
 * that — but that every DIVERGENCE is explained where a reader will find it.
 *
 * An unexplained omission is the dangerous one: a command dropped by accident
 * looks exactly like one excluded on purpose, and the app's fallback for a
 * command it does not know is to forward the raw text to the model as a prompt.
 */
const generatedSurface = await readFile(
  join(process.cwd(), 'server/gjc-command-surface.generated.ts'),
  'utf8',
);

test('every text builtin missing from the catalog is excluded with a written reason', () => {
  const catalog = new Set(GJC_APP_BUILTIN_COMMANDS.map((command) => command.name));
  const header = generatedSurface.slice(0, generatedSurface.indexOf('export type'));

  for (const command of ACP_BUILTIN_SLASH_COMMANDS) {
    if (catalog.has(command.name)) continue;
    assert.match(
      header,
      new RegExp(`^//\\s+${command.name}: \\S.*`, 'm'),
      `${command.name} is absent from the catalog with no recorded reason`,
    );
    assert.equal(
      GJC_APP_BUILTIN_COMMAND_NAMES.has(command.name),
      false,
      `${command.name} is documented as excluded but still dispatches`,
    );
  }
});

test('the catalog claims the desktop login aliases the runtime does not expose as text', () => {
  const advertised = new Set(ACP_BUILTIN_SLASH_COMMANDS.map((command) => command.name));
  for (const name of ['login', 'logout']) {
    // TUI-only upstream; the app claims them so the desktop answers with
    // guidance instead of forwarding the slash command to the model.
    assert.equal(advertised.has(name), false, `${name} is now a text builtin; drop the addition`);
    assert.equal(GJC_APP_BUILTIN_COMMAND_NAMES.has(name), true, `${name} must stay dispatched`);
  }
});

test('runtime aliases with text handlers are dispatchable but not advertised', () => {
  const advertised = new Set(GJC_APP_BUILTIN_COMMANDS.map((command) => command.name));
  for (const [alias, canonical] of Object.entries(GJC_APP_BUILTIN_COMMAND_ALIASES)) {
    // Dispatchable: without this the raw text reaches the model as a prompt.
    assert.equal(GJC_APP_BUILTIN_COMMAND_NAMES.has(alias), true, `${alias} must dispatch`);
    // Not advertised: the slash menu shows the canonical name only.
    assert.equal(advertised.has(alias), false, `${alias} must not be advertised`);
    assert.equal(advertised.has(canonical), true, `${canonical} must be advertised`);
  }
});

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
  /** Mirrors the SDK's own flag: true while a turn is in flight. */
  isStreaming = true;
  abortDeferred: Deferred<void> | undefined;
  disposeError: Error | undefined;
  promptCalls = 0;
  /** Messages that arrived while a turn was already running. */
  readonly steeredMessages: string[] = [];
  /** Which queue each of those messages asked for. */
  readonly steerBehaviors: Array<'steer' | 'followUp'> = [];
  readonly temporaryModelSelections: Array<{
    model: unknown;
    thinkingLevel: unknown;
    options: unknown;
  }> = [];
  readonly configuredModelChains: Array<{
    role: string;
    entries: string[];
    origin: string;
    identity: unknown;
    explicitHead: unknown;
  }> = [];
  readonly fallbackResolutions: Array<{ index: number; skipped: unknown[] }> = [];
  #turnInFlight = false;

  subscribe(listener: Listener): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  setToolUIContext(context: typeof this.uiContext): void { this.uiContext = context; }
  async prompt(message: string, options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void> {
    this.promptCalls += 1;
    // Mirrors the SDK: a busy agent refuses a bare prompt and requires the
    // caller to name the queue; a steer resolves as soon as it is queued rather
    // than waiting for the turn it joined.
    if (this.#turnInFlight) {
      if (!options?.streamingBehavior) {
        throw new Error('Agent is already processing. Use steer() or followUp() to queue messages, or wait for completion.');
      }
      this.steeredMessages.push(message);
      this.steerBehaviors.push(options.streamingBehavior!);
      return;
    }
    this.#turnInFlight = true;
    this.promptStarted.resolve();
    return this.#prompt.promise;
  }
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
  async setModelTemporary(model: unknown, thinkingLevel: unknown, options: unknown): Promise<void> {
    this.temporaryModelSelections.push({ model, thinkingLevel, options });
  }
  setConfiguredModelChain(
    role: string,
    entries: string[],
    origin: string,
    identity: unknown,
    explicitHead: unknown,
  ): void {
    this.configuredModelChains.push({ role, entries, origin, identity, explicitHead });
  }
  seedDefaultFallbackResolution(index: number, skipped: unknown[]): void {
    this.fallbackResolutions.push({ index, skipped });
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
  ...(globalMethods.has(method) ? {} : { sessionId }),
}) as GjcWorkerRequestFrame;

async function fixture(
  defaultModel: string | string[] = 'contract-model',
  modelProfile?: string,
  modelOrModels: { id: string; provider: string } | Array<{ id: string; provider: string }> = {
    id: 'contract-model',
    provider: 'contract-provider',
  },
  executeBuiltinCommand?: GjcBunSdkAdapterOptions['executeBuiltinCommand'],
  oauthLogin?: OAuthLogin,
  oauthTimeoutMs?: number,
  adapterOptionOverrides: Partial<GjcBunSdkAdapterOptions> = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'gjc-contract-'));
  const sessions: FakeAgentSession[] = [];
  const factoryOptions: Array<Record<string, unknown>> = [];
  const trace: string[] = [];
  const authStorage = {
    credentials: [] as Array<{ id: number; provider: string }>,
    exportSnapshot() { return { credentials: this.credentials }; },
    async login(provider: string, callbacks: OAuthCallbacks) {
      await oauthLogin?.(provider, callbacks);
      this.credentials.push({ id: this.credentials.length + 1, provider });
      trace.push('login.persist');
    },
    setRuntimeApiKey: () => {},
    removeRuntimeApiKey: () => {},
  };
  const models = Array.isArray(modelOrModels) ? modelOrModels : [modelOrModels];
  const modelRegistry = {
    authStorage,
    getAll: () => models,
    getAvailable: () => models,
    getCanonicalModelSelections: (query: { candidates?: typeof models } = {}) =>
      (query.candidates ?? models).map((model) => ({
        record: {
          id: model.id,
          name: 'name' in model && typeof model.name === 'string' ? model.name : model.id,
          variants: [{ canonicalId: model.id, selector: `${model.provider}/${model.id}`, model, source: 'bundled' }],
        },
        model,
      })),
    getModelProfile: () => undefined,
    async refresh() { trace.push('modelRegistry.refresh'); },
  };
  const factory = (async (input: Record<string, unknown>) => {
    factoryOptions.push(input);
    const session = new FakeAgentSession();
    sessions.push(session);
    return { session, setToolUIContext: session.setToolUIContext.bind(session) };
  }) as unknown as GjcAgentSessionFactory;
  // The per-run clone is what the adapter applies its tool policy to, so the
  // fake has to carry `override` like the real Settings does. Without it every
  // session creation threw and the whole file failed on "Fake session was not
  // created", which named the symptom and hid the cause.
  const overrides = new Map<string, unknown>();
  const settingsClone = () => ({
    getModelRole: () => defaultModel || undefined,
    override: (key: string, value: unknown) => { overrides.set(key, value); },
    get: (key: string) => overrides.get(key),
  });
  const settings = {
    getModelRole: () => defaultModel || undefined,
    get: (key: string) => key === 'modelProfile.default' ? modelProfile : undefined,
    cloneForCwd: async () => settingsClone(),
    toolPolicyOverrides: overrides,
  };
  const adapter = new GjcBunSdkAdapter(authStorage as never, modelRegistry as never, {
    createSessionFactory: factory,
    ...(adapterOptionOverrides.loadSettings ? {} : { settings: settings as never }),
    executeBuiltinCommand,
    ...(oauthTimeoutMs === undefined ? {} : { oauth: { timeoutMs: oauthTimeoutMs } }),
    ...adapterOptionOverrides,
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
  return { root, adapter, authStorage, modelRegistry, trace, factoryOptions, sessions, frames, host, options, toolPolicyOverrides: overrides, close: () => rm(root, { recursive: true, force: true }) };
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
    // `usage` must be the SDK's own `Usage` shape (input/output/cacheRead/
    // cacheWrite/totalTokens); the adapter translates it onto the browser's
    // used/inputTokens contract, so a made-up shape here would not exercise it.
    session.emit({ type: 'message_end', message: { role: 'assistant', content: [{ text: 'done' }], usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 4 } } });
    session.complete();
    await run;
    // Two `usage.updated` close the turn: the token budget, then the session
    // snapshot (model, reasoning level, cwd, context window) the composer
    // footer needs. Same method because they update at the same instant, but
    // separate payloads — the budget comes off the message, the snapshot off
    // the live session, which is the only place the context window exists.
    assert.deepEqual(methods(f.frames), ['session.created', 'message.delta', 'message.delta', 'tool.started', 'tool.completed', 'ask.presented', 'message.completed', 'usage.updated', 'usage.updated', 'turn.completed', 'worker.status']);
    assert.equal(methods(f.frames).filter((method) => method === 'turn.completed').length, 1);
    assert.equal(response(f.frames, 'golden').payload instanceof Object, true);
  } finally { await f.close(); }
});

test('advertised GJC builtins execute in the SDK worker without becoming model prompts', async () => {
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    async (_text, runtime) => {
      await runtime.output('background jobs: none');
      return { consumed: true };
    },
  );
  try {
    await f.host.handle(request('session.start', 'builtin-command', {
      message: '/jobs',
      options: f.options,
    }));
    const session = await firstSession(f.sessions);

    assert.equal(session.promptCalls, 0);
    assert.deepEqual(methods(f.frames), [
      'session.created',
      'message.completed',
      'turn.completed',
      'worker.status',
    ]);
  } finally {
    await f.close();
  }
});


test('builtin stdout is terminal-safe, preserves Unicode, and retains export path provenance', async () => {
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    async (text, runtime) => {
      if (text.startsWith('/export')) {
        await runtime.output('Export failed: \uFFFD');
      } else {
        await runtime.output('\u001B[31m$5\t中🙂 `code` <markup>\u001B[0m\n\u001B]8;;https://example.test\u0007link\u001B]8;;\u0007');
      }
      return { consumed: true };
    },
  );
  try {
    await f.host.handle(request('session.start', 'builtin-stdout', {
      message: '/jobs',
      options: f.options,
    }));
    await f.host.handle(request('session.start', 'export-corruption', {
      message: '/export nested/報告.html',
      options: f.options,
    }));

    const outputs = f.frames
      .filter((frame) => frame.kind === 'event' && frame.method === 'message.completed')
      .map((frame) => ((frame.payload as Record<string, unknown>).message as Record<string, unknown>))
      .filter((message) => message.isLocalCommandStdout === true);
    assert.deepEqual(outputs, [
      {
        kind: 'text',
        role: 'assistant',
        content: '$5\t中🙂 `code` <markup>\nlink',
        isLocalCommandStdout: true,
      },
      {
        kind: 'text',
        role: 'assistant',
        content: 'Failed to export "nested/報告.html": the upstream export command returned a corrupted path.',
        isLocalCommandStdout: true,
      },
    ]);
  } finally {
    await f.close();
  }
});

/*
 * `/export` containment across a shared worker.
 *
 * One worker process serves every session, so its cwd is fixed at spawn time
 * and cannot describe the run. These two tests pin the destination to the
 * per-run project directory instead: the first proves the rewrite happens at
 * the command boundary, the second proves it still tracks the run after the
 * adapter is already warm and has served a different project.
 */
test('/export is rewritten to an absolute path inside the run project directory', async () => {
  let executedText = '';
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    async (text, runtime) => {
      executedText = text;
      await runtime.output('Session exported to: ok');
      return { consumed: true };
    },
  );
  const projectCwd = await mkdtemp(join(tmpdir(), 'gjc-export-project-'));
  try {
    await f.host.handle(request('session.start', 'export-bare', {
      message: '/export',
      options: { ...f.options, cwd: projectCwd },
    }));

    const argument = executedText.replace(/^\/export\s+/, '');
    assert.notEqual(executedText, '/export');
    assert.ok(isAbsolute(argument), `expected an absolute export path, got ${argument}`);
    const containment = relative(await realpath(projectCwd), await realpath(join(argument, '..')));
    assert.equal(containment, '');
    assert.match(argument, /gjc-session-.*\.html$/);
  } finally {
    await rm(projectCwd, { recursive: true, force: true });
    await f.close();
  }
});

test('a warm adapter contains /export per run, not per worker lifetime', async () => {
  const executed: string[] = [];
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    async (text, runtime) => {
      executed.push(text);
      await runtime.output('Session exported to: ok');
      return { consumed: true };
    },
  );
  const firstCwd = await mkdtemp(join(tmpdir(), 'gjc-export-one-'));
  const secondCwd = await mkdtemp(join(tmpdir(), 'gjc-export-two-'));
  try {
    // A prose turn first, so the adapter is already warm and has been bound to
    // a project before either export runs.
    const warmup = f.host.handle(request('session.start', 'export-warmup', {
      message: 'hello',
      options: { ...f.options, cwd: firstCwd },
    }));
    const warmupSession = await firstSession(f.sessions);
    await warmupSession.promptStarted.promise;
    warmupSession.complete();
    await warmup;

    await f.host.handle(request('session.start', 'export-run-one', {
      message: '/export',
      options: { ...f.options, cwd: firstCwd },
    }));
    await f.host.handle(request('session.start', 'export-run-two', {
      message: '/export',
      options: { ...f.options, cwd: secondCwd },
    }));

    assert.equal(executed.length, 2);
    const [first, second] = executed.map((text) => text.replace(/^\/export\s+/, ''));
    assert.notEqual(first, second);
    assert.equal(relative(await realpath(firstCwd), await realpath(join(first!, '..'))), '');
    assert.equal(relative(await realpath(secondCwd), await realpath(join(second!, '..'))), '');
  } finally {
    await rm(firstCwd, { recursive: true, force: true });
    await rm(secondCwd, { recursive: true, force: true });
    await f.close();
  }
});

test('/login is rejected before builtin handling or model prompting', async () => {
  let executedText = '';
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    async (text, runtime) => {
      executedText = text;
      await runtime.output('unexpected');
      return { consumed: true };
    },
  );
  try {
    await f.host.handle(request('session.start', 'login-command', {
      message: '/login openai-codex',
      options: f.options,
    }));
    await f.host.handle(request('session.start', 'logout-command', {
      message: '/logout openai-codex',
      options: f.options,
    }));

    assert.equal(executedText, '');
    assert.equal(f.sessions.length, 0);
    assert.equal((response(f.frames, 'login-command').payload as Record<string, unknown>).ok, false);
    assert.equal((response(f.frames, 'logout-command').payload as Record<string, unknown>).ok, false);
  } finally {
    await f.close();
  }
});
test('OAuth Protocol v1 frames are global and exact', () => {
  for (const method of ['oauth.providers', 'oauth.status', 'oauth.start', 'oauth.submit', 'oauth.cancel']) {
    const frame = parseGjcWorkerFrame(JSON.stringify({
      protocolVersion: GJC_WORKER_PROTOCOL_VERSION,
      kind: 'request',
      id: `oauth-${method}`,
      method,
      payload: {},
    }));
    assert.equal(frame.kind, 'request');
    assert.equal('sessionId' in frame, false);
    assert.throws(
      () => parseGjcWorkerFrame(JSON.stringify({ ...frame, sessionId: 'contract-scope' })),
      { code: 'invalid_session_scope' },
    );
    const response = parseGjcWorkerFrame(JSON.stringify({
      protocolVersion: GJC_WORKER_PROTOCOL_VERSION,
      kind: 'response',
      id: `response-${method}`,
      method,
      payload: { ok: true },
    }));
    assert.equal(response.kind, 'response');
    assert.equal('sessionId' in response, false);
    assert.throws(
      () => parseGjcWorkerFrame(JSON.stringify({ ...response, sessionId: 'contract-scope' })),
      { code: 'invalid_session_scope' },
    );
  }
  for (const method of ['oauth.phase', 'oauth.providers.updated', 'provider.auth.updated']) {
    const frame = parseGjcWorkerFrame(JSON.stringify({
      protocolVersion: GJC_WORKER_PROTOCOL_VERSION,
      kind: 'event',
      id: `event-${method}`,
      method,
      payload: {},
    }));
    assert.equal(frame.kind, 'event');
    assert.equal('sessionId' in frame, false);
    assert.throws(
      () => parseGjcWorkerFrame(JSON.stringify({ ...frame, sessionId: 'contract-scope' })),
      { code: 'invalid_session_scope' },
    );
  }
});

test('model catalog reports the runtime-supported reasoning levels', async () => {
  const f = await fixture(
    'reasoning-model',
    undefined,
    {
      id: 'reasoning-model',
      name: 'Reasoning Model',
      provider: 'contract-provider',
      reasoning: true,
      thinking: {
        minLevel: 'low',
        maxLevel: 'high',
        levels: ['low', 'high'],
        mode: 'effort',
      },
    } as never,
  );
  try {
    f.authStorage.credentials.push({ id: 1, provider: 'contract-provider' });
    await f.host.handle(request('models.catalog', 'model-catalog'));
    const payload = response(f.frames, 'model-catalog').payload as Record<string, unknown>;
    assert.deepEqual(payload, {
      ok: true,
      result: {
        models: [{
          value: 'contract-provider/reasoning-model',
          label: 'Reasoning Model',
          group: 'contract-provider',
          canonicalId: 'reasoning-model',
          effort: { values: [{ value: 'low' }, { value: 'high' }] },
        }],
      },
    });
  } finally {
    await f.close();
  }
});

test('model catalog only exposes models backed by a stored subscription', async () => {
  const f = await fixture(
    'subscribed-model-high',
    undefined,
    [
      { id: 'subscribed-model-high', name: 'Subscribed', provider: 'cursor' },
      { id: 'unavailable-model', name: 'Unavailable', provider: 'openai-codex' },
    ] as never,
  );
  try {
    f.authStorage.credentials.push({ id: 25, provider: 'cursor' });
    await f.host.handle(request('models.catalog', 'stored-model-catalog'));
    const payload = response(f.frames, 'stored-model-catalog').payload as {
      result: { models: Array<{ value: string; effort: { default?: string } }> };
    };

    assert.deepEqual(payload.result.models.map((model) => model.value), ['cursor/subscribed-model-high']);
    assert.equal(payload.result.models[0]?.effort.default, 'high');
  } finally {
    await f.close();
  }
});

test('OAuth provider list exposes canonical safe descriptors', async () => {
  const f = await fixture();
  try {
    f.authStorage.credentials.push({ id: 7, provider: 'openai-codex' });
    await f.host.handle(request('oauth.providers', 'oauth-providers'));
    const result = ((response(f.frames, 'oauth-providers').payload as Record<string, unknown>).result ?? {}) as Record<string, unknown>;
    const providers = result.providers as Array<Record<string, unknown>>;
    const provider = providers.find((candidate) => candidate.id === 'openai-codex');

    assert.deepEqual(Object.keys(provider ?? {}).slice(0, 4), ['id', 'name', 'available', 'authenticated']);
    assert.equal(provider?.authenticated, true);
    assert.equal(JSON.stringify(result).includes('credential'), false);
  } finally {
    await f.close();
  }
});

test('OAuth callbacks emit safe phases and refresh before auth update completion', async () => {
  const manualCanary = 'manual-oauth-canary';
  const promptCanary = 'prompt-oauth-canary';
  const passwordCanary = 'password-oauth-canary';
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    undefined,
    async (provider, callbacks) => {
      assert.equal(provider, 'openai-codex');
      callbacks.onAuth({ url: 'https://login.example.test/authorize', instructions: 'Complete browser sign-in.' });
      callbacks.onProgress?.('Waiting for browser authentication.');
      assert.equal(await callbacks.onManualCodeInput!(), manualCanary);
      assert.equal(await callbacks.onPrompt({ message: 'Enter the displayed code', placeholder: 'Code' }), promptCanary);
      assert.equal(await callbacks.onPrompt({ message: 'Enter your password', placeholder: 'Password' }), passwordCanary);
    },
  );
  try {
    await f.host.handle(request('oauth.start', 'oauth-start', { providerId: 'openai-codex' }));
    const start = ((response(f.frames, 'oauth-start').payload as Record<string, unknown>).result ?? {}) as Record<string, unknown>;
    const attemptId = start.attemptId as string;

    await waitFor(() => (f.frames
      .filter((frame) => frame.method === 'oauth.phase')
      .map((frame) => frame.payload as Record<string, unknown>)
      .find((phase) => phase.attemptId === attemptId && phase.valueKind === 'manual_code')));
    await f.host.handle(request('oauth.submit', 'oauth-submit-manual', { attemptId, value: manualCanary }));
    const promptPhase = await waitFor(() => f.frames
      .filter((frame) => frame.method === 'oauth.phase')
      .map((frame) => frame.payload as Record<string, unknown>)
      .find((phase) => phase.attemptId === attemptId && phase.valueKind === 'prompt'));
    assert.equal(promptPhase.password, undefined);
    await f.host.handle(request('oauth.submit', 'oauth-submit-prompt', { attemptId, value: promptCanary }));


    const passwordPhase = await waitFor(() => f.frames
      .filter((frame) => frame.method === 'oauth.phase')
      .map((frame) => frame.payload as Record<string, unknown>)
      .find((phase) => phase.attemptId === attemptId && phase.valueKind === 'password'));
    assert.equal(passwordPhase.password, true);
    await f.host.handle(request('oauth.submit', 'oauth-submit-password', { attemptId, value: passwordCanary }));

    await waitFor(() => f.frames
      .filter((frame) => frame.method === 'oauth.phase')
      .map((frame) => frame.payload as Record<string, unknown>)
      .find((phase) => phase.attemptId === attemptId && phase.phase === 'completed'));

    assert.deepEqual(f.trace, ['login.persist', 'modelRegistry.refresh']);
    const providerAuthEvent = f.frames.findIndex((frame) => frame.method === 'provider.auth.updated');
    const completedPhase = f.frames.findIndex((frame) => frame.method === 'oauth.phase'
      && (frame.payload as Record<string, unknown>).phase === 'completed');
    assert.ok(providerAuthEvent >= 0 && providerAuthEvent < completedPhase);
    assert.equal(JSON.stringify(f.frames).includes(manualCanary), false);
    assert.equal(JSON.stringify(f.frames).includes(promptCanary), false);
    assert.equal(JSON.stringify(f.frames).includes(passwordCanary), false);
  } finally {
    await f.close();
  }
});
test('OAuth refresh failure preserves persisted auth state and reports a distinct safe error', async () => {
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    undefined,
    async () => {},
  );
  f.modelRegistry.refresh = async () => {
    f.trace.push('modelRegistry.refresh');
    throw new Error('refresh canary must not cross the worker protocol');
  };

  try {
    await f.host.handle(request('oauth.start', 'oauth-refresh-failure', { providerId: 'openai-codex' }));
    const start = ((response(f.frames, 'oauth-refresh-failure').payload as Record<string, unknown>).result ?? {}) as Record<string, unknown>;
    const attemptId = start.attemptId as string;
    const failed = await waitFor(() => f.frames
      .filter((frame) => frame.method === 'oauth.phase')
      .map((frame) => frame.payload as Record<string, unknown>)
      .find((phase) => phase.attemptId === attemptId && phase.phase === 'failed'));

    assert.deepEqual(f.trace, ['login.persist', 'modelRegistry.refresh']);
    assert.equal(f.authStorage.credentials.some((credential) => credential.provider === 'openai-codex'), true);
    assert.equal(failed.errorCode, 'oauth_model_refresh_failed');
    assert.equal(f.frames.some((frame) => frame.method === 'provider.auth.updated'
      && (frame.payload as Record<string, unknown>).authenticated === true), true);
    assert.equal(f.frames.some((frame) => frame.method === 'oauth.providers.updated'), true);
    assert.equal(JSON.stringify(f.frames).includes('refresh canary'), false);
  } finally {
    await f.close();
  }
});

test('OAuth automatic callback flow completes without a manual submit', async () => {
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    undefined,
    async (_provider, callbacks) => {
      callbacks.onAuth({
        url: 'https://login.example.test/authorize',
        instructions: 'Complete sign-in in the browser.',
      });
    },
  );

  try {
    await f.host.handle(request('oauth.start', 'oauth-automatic-start', { providerId: 'openai-codex' }));
    const start = ((response(f.frames, 'oauth-automatic-start').payload as Record<string, unknown>).result ?? {}) as Record<string, unknown>;
    const attemptId = start.attemptId as string;
    const phases = () => f.frames
      .filter((frame) => frame.method === 'oauth.phase')
      .map((frame) => frame.payload as Record<string, unknown>)
      .filter((phase) => phase.attemptId === attemptId);

    await waitFor(() => phases().find((phase) => phase.phase === 'completed'));
    assert.equal(phases().some((phase) => phase.phase === 'awaiting_browser'
      && phase.authorizationUrl === 'https://login.example.test/authorize'), true);
    assert.deepEqual(f.trace, ['login.persist', 'modelRegistry.refresh']);
    assert.equal(f.frames.some((frame) => frame.method === 'provider.auth.updated'), true);
  } finally {
    await f.close();
  }
});

test('OAuth rejects concurrent, wrong, oversized, and duplicate submissions with safe errors', async () => {
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    undefined,
    async (_provider, callbacks) => {
      await callbacks.onPrompt({ message: 'Enter a password', placeholder: 'Password' });
    },
  );

  try {
    await f.host.handle(request('oauth.start', 'oauth-adversarial-start', { providerId: 'openai-codex' }));
    const start = ((response(f.frames, 'oauth-adversarial-start').payload as Record<string, unknown>).result ?? {}) as Record<string, unknown>;
    const attemptId = start.attemptId as string;
    await waitFor(() => f.frames
      .filter((frame) => frame.method === 'oauth.phase')
      .map((frame) => frame.payload as Record<string, unknown>)
      .find((phase) => phase.attemptId === attemptId && phase.phase === 'awaiting_input'));

    await f.host.handle(request('oauth.start', 'oauth-concurrent-start', { providerId: 'openai-codex' }));
    assert.equal(((response(f.frames, 'oauth-concurrent-start').payload as Record<string, unknown>).error as Record<string, unknown>).code, 'oauth_attempt_active');

    const wrongCanary = 'wrong-attempt-secret-canary';
    await f.host.handle(request('oauth.submit', 'oauth-wrong-submit', {
      attemptId: 'oauth-wrong-attempt',
      value: wrongCanary,
    }));
    assert.equal(((response(f.frames, 'oauth-wrong-submit').payload as Record<string, unknown>).error as Record<string, unknown>).code, 'oauth_attempt_not_found');

    const oversizedCanary = `oversized-${'x'.repeat(16 * 1024)}`;
    await f.host.handle(request('oauth.submit', 'oauth-oversized-submit', {
      attemptId,
      value: oversizedCanary,
    }));
    assert.equal(((response(f.frames, 'oauth-oversized-submit').payload as Record<string, unknown>).error as Record<string, unknown>).code, 'oauth_submit_too_large');

    const acceptedCanary = 'accepted-secret-canary';
    await f.host.handle(request('oauth.submit', 'oauth-valid-submit', { attemptId, value: acceptedCanary }));
    const duplicateCanary = 'duplicate-secret-canary';
    await f.host.handle(request('oauth.submit', 'oauth-duplicate-submit', { attemptId, value: duplicateCanary }));
    const duplicateCode = ((response(f.frames, 'oauth-duplicate-submit').payload as Record<string, unknown>).error as Record<string, unknown>).code;
    assert.equal(['oauth_input_not_requested', 'oauth_attempt_not_active'].includes(String(duplicateCode)), true);

    const serializedFrames = JSON.stringify(f.frames);
    for (const canary of [wrongCanary, oversizedCanary, acceptedCanary, duplicateCanary]) {
      assert.equal(serializedFrames.includes(canary), false);
    }
  } finally {
    await f.close();
  }
});
test('OAuth cancel aborts the active canonical login and replays safe status', async () => {
  let callbacks: OAuthCallbacks | undefined;
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    undefined,
    async (_provider, current) => {
      callbacks = current;
      await current.onPrompt({ message: 'Enter your password' });
    },
  );
  try {
    await f.host.handle(request('oauth.start', 'oauth-cancel-start', { providerId: 'openai-codex' }));
    const start = ((response(f.frames, 'oauth-cancel-start').payload as Record<string, unknown>).result ?? {}) as Record<string, unknown>;
    const attemptId = start.attemptId as string;
    await waitFor(() => callbacks);

    await waitFor(() => f.frames
      .filter((frame) => frame.method === 'oauth.phase')
      .map((frame) => frame.payload as Record<string, unknown>)
      .find((phase) => phase.attemptId === attemptId && phase.phase === 'awaiting_input'));
    await f.host.handle(request('oauth.cancel', 'oauth-cancel', { attemptId }));
    assert.equal(callbacks?.signal?.aborted, true);

    await f.host.handle(request('oauth.status', 'oauth-cancel-status'));
    const status = ((response(f.frames, 'oauth-cancel-status').payload as Record<string, unknown>).result ?? {}) as Record<string, unknown>;
    assert.equal((status.attempt as Record<string, unknown>).phase, 'cancelled');

    const canary = 'cancelled-oauth-secret';
    await f.host.handle(request('oauth.submit', 'oauth-cancel-late-submit', { attemptId, value: canary }));
    const lateSubmit = response(f.frames, 'oauth-cancel-late-submit').payload as Record<string, unknown>;
    assert.equal((lateSubmit.error as Record<string, unknown>).code, 'oauth_attempt_not_active');
    assert.equal(JSON.stringify(f.frames).includes(canary), false);
  } finally {
    await f.close();
  }
});

test('OAuth timeout rejects late secret submission without refreshing models', async () => {
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    undefined,
    async (_provider, callbacks) => {
      await callbacks.onPrompt({ message: 'Enter a code' });
    },
    5,
  );
  try {
    await f.host.handle(request('oauth.start', 'oauth-timeout-start', { providerId: 'openai-codex' }));
    const start = ((response(f.frames, 'oauth-timeout-start').payload as Record<string, unknown>).result ?? {}) as Record<string, unknown>;
    const attemptId = start.attemptId as string;

    await waitFor(() => f.frames
      .filter((frame) => frame.method === 'oauth.phase')
      .map((frame) => frame.payload as Record<string, unknown>)
      .find((phase) => phase.attemptId === attemptId && phase.phase === 'timed_out'));

    const canary = 'timed-out-oauth-secret';
    await f.host.handle(request('oauth.submit', 'oauth-timeout-late-submit', { attemptId, value: canary }));
    const lateSubmit = response(f.frames, 'oauth-timeout-late-submit').payload as Record<string, unknown>;
    assert.equal((lateSubmit.error as Record<string, unknown>).code, 'oauth_attempt_not_active');
    assert.deepEqual(f.trace, []);
    assert.equal(JSON.stringify(f.frames).includes(canary), false);
  } finally {
    await f.close();
  }
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
test('session effort is passed to the SDK as the turn thinking level', async () => {
  const f = await fixture();
  try {
    const run = f.host.handle(request('session.start', 'reasoning-effort', {
      message: 'reason',
      options: { ...f.options, effort: 'high' },
    }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    session.complete();
    await run;
    assert.equal(f.factoryOptions[0]!.thinkingLevel, 'high');
    assert.deepEqual(session.temporaryModelSelections, [{
      model: { id: 'contract-model', provider: 'contract-provider' },
      thinkingLevel: 'high',
      options: { persistAsSessionDefault: true, cause: 'startup-override' },
    }]);
  } finally { await f.close(); }
});
test('a resumed session applies the app-pinned model as the authoritative default chain', async () => {
  const f = await fixture(
    ['glm-zcode53/glm-5.3:high', 'glm-zcode/glm-5.2:high'],
    undefined,
    [
      { id: 'gpt-5.6-sol', provider: 'openai-codex' },
      { id: 'glm-5.3', provider: 'glm-zcode53' },
      { id: 'glm-5.2', provider: 'glm-zcode' },
    ],
  );
  try {
    const providerSessionId = 'resume-with-pinned-sol';
    await writeFile(join(f.root, 'pinned.jsonl'), `${JSON.stringify({
      type: 'session', version: 3, id: providerSessionId, timestamp: new Date().toISOString(), cwd: f.root,
    })}\n`);
    const run = f.host.handle(request('session.resume', 'resume-pinned-model', {
      message: 'continue with sol',
      options: { ...f.options, modelId: 'openai-codex/gpt-5.6-sol', effort: 'medium' },
      providerSessionId,
    }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    session.complete();
    await run;

    assert.deepEqual(session.temporaryModelSelections, [{
      model: { id: 'gpt-5.6-sol', provider: 'openai-codex' },
      thinkingLevel: 'medium',
      options: { persistAsSessionDefault: true, cause: 'startup-override' },
    }]);
    assert.deepEqual(session.configuredModelChains, [{
      role: 'default',
      entries: ['openai-codex/gpt-5.6-sol'],
      origin: 'startup-override',
      identity: undefined,
      explicitHead: true,
    }]);
    assert.deepEqual(session.fallbackResolutions, [{ index: 0, skipped: [] }]);
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
    // The SDK reports session files as realpaths, so containment is compared
    // against the resolved root (macOS /var is a symlink to /private/var).
    const resolvedRoot = await realpath(f.root);
    for (const factoryInput of f.factoryOptions) {
      const sessionFile = (factoryInput.sessionManager as { getSessionFile(): string | undefined }).getSessionFile();
      assert.ok(sessionFile);
      const relativeSessionFile = relative(resolvedRoot, sessionFile);
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
test('settings loader resolves the current default model role for each run', async () => {
  let loads = 0;
  const settingsFor = (modelId: string) => ({
    getModelRole: () => `contract-provider/${modelId}`,
    get: () => undefined,
    cloneForCwd: async () => ({
      getModelRole: () => `contract-provider/${modelId}`,
      override: () => undefined,
      get: () => undefined,
    }),
  });
  const f = await fixture(
    'first-model',
    undefined,
    [
      { id: 'first-model', provider: 'contract-provider' },
      { id: 'second-model', provider: 'contract-provider' },
    ],
    undefined,
    undefined,
    undefined,
    {
      loadSettings: async () => {
        loads += 1;
        return settingsFor(loads === 1 ? 'first-model' : 'second-model') as never;
      },
    },
  );
  try {
    const first = f.host.handle(request('session.start', 'fresh-default-first', {
      message: 'first',
      options: { ...f.options, modelId: 'default' },
    }));
    const initialSession = await firstSession(f.sessions);
    initialSession.complete();
    await first;

    const second = f.host.handle(request('session.start', 'fresh-default-second', {
      message: 'second',
      options: { ...f.options, modelId: 'default' },
    }));
    const secondSession = await waitFor(() => f.sessions[1]);
    secondSession.complete();
    await second;

    assert.equal(loads, 2);
    assert.equal((f.factoryOptions[0]!.model as { id: string }).id, 'first-model');
    assert.equal((f.factoryOptions[1]!.model as { id: string }).id, 'second-model');
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
test('default model role uses the primary selector from a fallback chain', async () => {
  const f = await fixture(['missing/model:high', 'openai-codex/gpt-5.6-terra:high'], undefined, {
    id: 'gpt-5.6-terra',
    provider: 'openai-codex',
  });
  try {
    const run = f.host.handle(request('session.start', 'default-model-role-chain', {
      message: 'hello',
      options: { ...f.options, modelId: 'default' },
    }));
    const session = await firstSession(f.sessions);
    session.complete();
    await run;
    assert.equal(f.factoryOptions[0]!.model && (f.factoryOptions[0]!.model as { id: string }).id, 'gpt-5.6-terra');
  } finally { await f.close(); }
});
test('default model fallback skips providers that do not match the stored credential', async () => {
  const f = await fixture(
    ['glm-zcode53/glm-5.3:high', 'glm-zcode/glm-5.2:high'],
    undefined,
    [
      { id: 'glm-5.3', provider: 'glm-zcode53' },
      { id: 'glm-5.2', provider: 'glm-zcode' },
    ],
  );
  f.authStorage.credentials.push({ id: 28, provider: 'glm-zcode' });
  try {
    const run = f.host.handle(request('session.start', 'default-model-stored-fallback', {
      message: 'hello',
      options: { ...f.options, modelId: 'default', credential: { kind: 'stored' } },
    }));
    const session = await firstSession(f.sessions);
    session.complete();
    await run;
    assert.equal((f.factoryOptions[0]!.model as { provider: string }).provider, 'glm-zcode');
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
test('app automation is injected through the SDK built-in automationTools contract', async () => {
  const f = await fixture();
  try {
    const run = f.host.handle(request('session.start', 'automation-tools', {
      message: 'hello',
      options: f.options,
    }, 'app-session-a'));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    const factoryInput = f.factoryOptions[0]!;
    const automationTools = factoryInput.automationTools as Record<string, { name: string }>;
    assert.equal(factoryInput.customTools, undefined);
    assert.deepEqual(Object.keys(automationTools).sort(), ['browser', 'computer']);
    assert.equal(automationTools.browser?.name, 'browser');
    assert.equal(automationTools.computer?.name, 'computer');
    session.complete();
    await run;
  } finally { await f.close(); }
});
test('abort closes the app automation session before reporting success', async () => {
  const cleanup = deferred<void>();
  const closedSessions: string[] = [];
  const f = await fixture(
    'contract-model',
    undefined,
    { id: 'contract-model', provider: 'contract-provider' },
    undefined,
    undefined,
    undefined,
    {
      closeAutomationSession: async (appSessionId) => {
        closedSessions.push(appSessionId);
        await cleanup.promise;
      },
    },
  );
  try {
    const run = f.host.handle(request('session.start', 'abort-automation', {
      message: 'hello',
      options: f.options,
    }, 'app-session-a'));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    const abort = f.host.handle(request(
      'turn.abort',
      'abort-automation-request',
      { runId: 'abort-automation' },
      'app-session-a',
    ));
    await session.abortStarted.promise;
    await Promise.resolve();
    assert.deepEqual(closedSessions, ['app-session-a']);
    assert.equal(response(f.frames, 'abort-automation-request'), undefined);
    cleanup.resolve();
    await abort;
    await run;
    assert.deepEqual(
      (response(f.frames, 'abort-automation-request').payload as Record<string, unknown>).result,
      { runId: 'abort-automation', aborted: true },
    );
  } finally { await f.close(); }
});
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
    // Zero stored rows for the model provider stays fail-closed off desktop.
    const desktop = process.env.GJC_DESKTOP;
    delete process.env.GJC_DESKTOP;
    try {
      f.authStorage.credentials = [];
      await f.host.handle(request('session.start', 'invalid-zero-rows', { message: 'x', options: { ...f.options, credential: { kind: 'stored' } } }));
      assert.equal((response(f.frames, 'invalid-zero-rows').payload as Record<string, unknown>).ok, false);
      assert.equal(f.sessions.length, 0);
    } finally {
      if (desktop === undefined) delete process.env.GJC_DESKTOP; else process.env.GJC_DESKTOP = desktop;
    }
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

test('desktop runs accept a provider whose key comes from the GJC config instead of a stored row', async () => {
  const f = await fixture();
  const desktop = process.env.GJC_DESKTOP;
  process.env.GJC_DESKTOP = '1';
  try {
    // The operator's own ~/.gjc install authenticates this provider through
    // models.yml (apiKey / apiKeyEnv), so it never gets a stored row.
    f.authStorage.credentials = [];
    const run = f.host.handle(request('session.start', 'desktop-config-key', { message: 'x', options: { ...f.options, credential: { kind: 'stored' } } }));
    const session = await firstSession(f.sessions);
    session.complete();
    await run;

    const payload = response(f.frames, 'desktop-config-key').payload as Record<string, unknown>;
    assert.equal(payload.ok, true);
    // No selector is installed, which is what lets the SDK use the configured key.
    const factoryInput = f.factoryOptions.at(-1) as { credentialSelector?: unknown };
    assert.equal(factoryInput.credentialSelector, undefined);
    assert.equal((payload.result as Record<string, unknown>).credential, undefined);

    // A pinned reference is an assertion about stored rows and still fails closed.
    for (const [index, credential] of [{ kind: 'stored', providerId: 'contract-provider' }, { kind: 'stored', credentialId: 4 }].entries()) {
      await f.host.handle(request('session.start', `desktop-pinned-${index}`, { message: 'x', options: { ...f.options, credential } }));
      assert.equal((response(f.frames, `desktop-pinned-${index}`).payload as Record<string, unknown>).ok, false);
    }
    assert.equal(f.sessions.length, 1);
  } finally {
    if (desktop === undefined) delete process.env.GJC_DESKTOP; else process.env.GJC_DESKTOP = desktop;
    await f.close();
  }
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

test('the SDK bootstrap initializes the global theme the ask tool renders every question through', async () => {
  await ensureSdkThemeInitialized();
  const { theme } = await import('@gajae-code/coding-agent/modes/theme/theme');

  // `ask` builds its selector labels from these symbols for every question
  // (`${theme.status.success} Done selecting`, `theme.checkbox.*`). Only the GJC
  // CLI entrypoints call `initTheme`, so before the bootstrap existed the first
  // option-bearing question threw "undefined is not an object (evaluating
  // 'theme.status')" and took the whole worker down.
  assert.equal(typeof theme.status.success, 'string');
  assert.ok(theme.status.success.length > 0);
  assert.equal(typeof theme.checkbox.checked, 'string');
  assert.equal(typeof theme.checkbox.unchecked, 'string');

  // Idempotent: a second bootstrap must not reload or swap the live instance.
  await ensureSdkThemeInitialized();
  assert.equal((await import('@gajae-code/coding-agent/modes/theme/theme')).theme, theme);
});

test('the pinned SDK ask tool still renders through the global theme instance', async () => {
  const askSource = await readFile(
    join(process.cwd(), 'node_modules', '@gajae-code', 'coding-agent', 'src', 'tools', 'ask.ts'),
    'utf8',
  );
  // Drift guard: if upstream stops dereferencing the process-global theme, this
  // fails and `ensureSdkThemeInitialized` can be dropped instead of lingering.
  assert.match(askSource, /theme\??\.status\??\./u);
  assert.match(askSource, /theme\??\.checkbox\??\./u);
});

test('the SDK runtime bootstrap initializes the theme before any session can ask', async () => {
  const adapterSource = await readFile(join(process.cwd(), 'server', 'gjc-bun-sdk-adapter.ts'), 'utf8');
  const bootstrap = adapterSource.slice(adapterSource.indexOf('export async function createGjcBunSdkAdapter'));
  // The worker builds its runtime here and nowhere else, so dropping this call
  // would leave every option-bearing ask crashing again with a passing suite.
  assert.match(bootstrap, /ensureSdkThemeInitialized\(\)/u);
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

test('a message sent during a run is steered into the turn already in flight', async () => {
  const f = await fixture();
  try {
    const run = f.host.handle(request('session.start', 'steer-live', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    assert.equal(session.promptCalls, 1);

    await f.host.handle(request('turn.steer', 'steer-live-request', { runId: 'steer-live', message: 'actually, use TypeScript' }));

    // Steering rides the session's own prompt(), which the SDK routes into its
    // steering queue while streaming — no second run is started for it.
    assert.deepEqual(
      response(f.frames, 'steer-live-request').payload,
      { ok: true, result: { runId: 'steer-live', steered: true } },
    );
    assert.equal(session.promptCalls, 2);
    assert.deepEqual(session.steeredMessages, ['actually, use TypeScript']);
    assert.deepEqual(session.steerBehaviors, ['steer']);
    assert.equal(f.sessions.length, 1);

    session.complete();
    await run;
  } finally { await f.close(); }
});

test('a settled turn refuses steering rather than silently starting another one', async () => {
  const f = await fixture();
  try {
    const run = f.host.handle(request('session.start', 'steer-settled', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    session.isStreaming = false;

    await f.host.handle(request('turn.steer', 'steer-settled-request', { runId: 'steer-settled', message: 'too late' }));

    assert.deepEqual(
      response(f.frames, 'steer-settled-request').payload,
      { ok: true, result: { runId: 'steer-settled', steered: false } },
    );
    assert.equal(session.promptCalls, 1);

    session.complete();
    await run;
  } finally { await f.close(); }
});

test('an aborting run refuses steering, because its turn is already ending', async () => {
  const f = await fixture();
  try {
    const run = f.host.handle(request('session.start', 'steer-aborting', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;
    // Hold the abort in flight so the run is observably mid-abort.
    session.abortDeferred = deferred<void>();
    const abort = f.host.handle(request('turn.abort', 'steer-aborting-abort', { runId: 'steer-aborting' }));
    await session.abortStarted.promise;

    await f.host.handle(request('turn.steer', 'steer-aborting-request', { runId: 'steer-aborting', message: 'wait' }));

    assert.deepEqual(
      response(f.frames, 'steer-aborting-request').payload,
      { ok: true, result: { runId: 'steer-aborting', steered: false } },
    );
    assert.equal(session.promptCalls, 1);
    assert.deepEqual(session.steeredMessages, []);

    session.abortDeferred.resolve();
    await abort;
    await run;
  } finally { await f.close(); }
});

test('steering an unknown run is refused instead of reaching the runtime', async () => {
  const f = await fixture();
  try {
    await f.host.handle(request('turn.steer', 'steer-missing', { runId: 'no-such-run', message: 'hello' }));

    const payload = response(f.frames, 'steer-missing').payload as Record<string, unknown>;
    assert.equal(payload.ok, false);
    assert.equal((payload.error as Record<string, unknown>).code, 'run_not_found');
  } finally { await f.close(); }
});

test('steering rejects a payload with nothing to say', async () => {
  const f = await fixture();
  try {
    const run = f.host.handle(request('session.start', 'steer-blank', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);
    await session.promptStarted.promise;

    await f.host.handle(request('turn.steer', 'steer-blank-request', { runId: 'steer-blank', message: '   ' }));

    const payload = response(f.frames, 'steer-blank-request').payload as Record<string, unknown>;
    assert.equal(payload.ok, false);
    assert.equal((payload.error as Record<string, unknown>).code, 'invalid_payload');
    assert.equal(session.promptCalls, 1);

    session.complete();
    await run;
  } finally { await f.close(); }
});

/*
 * The app's tool policy has to survive the real session-creation path, not just
 * be correct in isolation.
 *
 * `server/gjc-agent-tools.ts` reads as a closed allowlist, but the runtime
 * treats `toolNames` as a seed and appends to it from settings that default to
 * true - which is how goal mode ran in every browser session while the file
 * said it was withheld. The adapter now forces those settings on the per-run
 * clone, and this pins that it actually happens where a session is built.
 */
test('starting a session forces the tool settings the app policy declares', async () => {
  const f = await fixture();
  try {
    // Not awaited: `session.start` settles only when the turn completes, and
    // the policy is applied while the session is being built.
    const run = f.host.handle(request('session.start', 'tool-policy', { message: 'hello', options: f.options }));
    const session = await firstSession(f.sessions);

    assert.equal(f.toolPolicyOverrides.get('goal.enabled'), false);
    assert.equal(f.toolPolicyOverrides.get('astEdit.enabled'), false);

    session.complete();
    await run;
  } finally {
    await f.close();
  }
});
