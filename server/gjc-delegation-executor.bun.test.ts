import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { createAgentSession, discoverAuthStorage, type CreateAgentSessionOptions } from '@gajae-code/coding-agent/sdk/session';
import { ModelRegistry } from '@gajae-code/coding-agent/config/model-registry';
import { Settings } from '@gajae-code/coding-agent/config/settings';
import { SessionManager } from '@gajae-code/coding-agent/session/session-manager';
import type { ExtensionAPI } from '@gajae-code/coding-agent/extensibility/extensions/types';
import { registerCustomApi, unregisterCustomApis } from '@gajae-code/ai/api-registry';
import { AssistantMessageEventStream } from '@gajae-code/ai/utils/event-stream';
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from '@gajae-code/ai/types';
import * as z from 'zod/v4';

import { GjcDelegationExecutor, serializeGjcDelegationAutomationTools } from './gjc-delegation-executor.js';
import type { GjcPermissionProvider } from './gjc-bun-permission-gate.js';
import { GjcBunSdkAdapter } from './gjc-bun-sdk-adapter.js';

type Session = Awaited<ReturnType<typeof createAgentSession>>['session'];
type Snapshot = { id: string; status: string; resultText: string };
const API = 'app-delegation-offline-contract';

function answer(text = 'Offline child complete.'): AssistantMessage {
  return {
    role: 'assistant', content: [{ type: 'text', text }], api: API,
    provider: 'openai-codex', model: 'gpt-6-astra', stopReason: 'stop', timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

function stream(message: AssistantMessage) {
  const events = new AssistantMessageEventStream();
  events.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
  events.end(message);
  return events;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(
  respond: (context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream = () => stream(answer()),
  provider?: GjcPermissionProvider,
  configureChild?: (options: CreateAgentSessionOptions) => CreateAgentSessionOptions | Promise<CreateAgentSessionOptions>,
  storedCredentials = false,
) {
  const scratch = join(await realpath(process.cwd()), '.tmp');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'delegation-contract-'));
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  await mkdir(cwd);
  const authStorage = await discoverAuthStorage(agentDir);
  const credential = { expected: 'offline-delegation-credential' };
  if (storedCredentials) {
    await authStorage.set('openai-codex', [
      { type: 'oauth', access: 'offline-account-a', refresh: 'offline-refresh-a', expires: Date.now() + 3_600_000, accountId: 'account-a' },
      { type: 'oauth', access: 'offline-account-b', refresh: 'offline-refresh-b', expires: Date.now() + 3_600_000, accountId: 'account-b' },
    ]);
    credential.expected = 'offline-account-a';
  }
  const settings = await Settings.loadForScope({ cwd, agentDir });
  settings.override('memory.enabled', false);
  settings.override('goal.enabled', false);
  settings.override('astEdit.enabled', false);
  settings.override('mcp.discoveryMode', false);
  settings.override('skills.enabled', false);
  const registry = new ModelRegistry(authStorage, join(agentDir, 'models.yml'), settings, { agentDir });
  registry.registerProvider('openai-codex', {
    api: API,
    ...(storedCredentials ? { oauth: {
      name: 'Offline stored-account fixture',
      login: async () => { throw new Error('Offline fixture must not log in.'); },
      refreshToken: async () => { throw new Error('Offline fixture must not refresh.'); },
      getApiKey: (credentials: { access: string }) => credentials.access,
    } } : { apiKey: 'offline-delegation-credential' }),
    baseUrl: 'http://127.0.0.1:1',
    models: [{ id: 'gpt-6-astra', name: 'Offline Astra contract', reasoning: true,
      thinking: { mode: 'effort', minLevel: 'xhigh', maxLevel: 'xhigh', levels: ['xhigh'] },
      input: ['text'], contextWindow: 100000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  });
  const model = registry.find('openai-codex', 'gpt-6-astra');
  assert.ok(model);
  const calls: Array<{ model: Model; context: Context; options?: SimpleStreamOptions }> = [];
  registerCustomApi(API, (selected, context, options) => {
    assert.equal(selected.provider, 'openai-codex');
    assert.equal(selected.id, 'gpt-6-astra');
    assert.equal(options?.reasoning, 'xhigh');
    assert.equal(options?.apiKey, credential.expected);
    calls.push({ model: selected, context, options });
    return respond(context, options);
  }, root);
  const childInputs: CreateAgentSessionOptions[] = [];
  const children: Session[] = [];
  const allRoots: Session[] = [];
  const executors: GjcDelegationExecutor[] = [];
  let browserCalls = 0;
  const base: CreateAgentSessionOptions = {
    cwd, agentDir, settings, authStorage, modelRegistry: registry, model, thinkingLevel: 'xhigh',
    toolNames: ['bash', 'read', 'task', 'subagent', 'browser', 'app_probe'], spawns: '*',
    automationTools: serializeGjcDelegationAutomationTools({ browser: {
      name: 'browser', label: 'App browser', description: 'App-owned browser fixture.',
      parameters: z.object({ action: z.literal('open') }),
      execute: async () => { browserCalls += 1; return { content: [{ type: 'text', text: 'app-browser-canary' }] }; },
    } }),
    customTools: [{
      name: 'app_probe', label: 'App override', description: 'App-owned custom tool fixture.',
      parameters: z.object({}),
      execute: async () => ({ content: [{ type: 'text', text: 'app-override-canary' }] }),
    }],
    enableMcpAutoload: false, enableLsp: false, skipPythonPreflight: true, disableExtensionDiscovery: true,
    skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
    systemPrompt: ['Offline SDK delegation contract.'],
  };
  const createParent = async (manager = SessionManager.create(cwd, join(root, 'sessions'))) => {
    const executor = new GjcDelegationExecutor({ parent: manager, session: () => parent, sessionOptions: base,
      permissionProvider: provider,
      createSession: async (options) => {
        childInputs.push(options!);
        const result = await createAgentSession(configureChild ? await configureChild(options!) : options);
        children.push(result.session);
        return result;
      },
    });
    executors.push(executor);
    const created = await createAgentSession({ ...base, sessionManager: manager,
      toolNames: base.toolNames!.filter((name) => name !== 'task' && name !== 'subagent'), spawns: 'deny',
      customTools: [...base.customTools!, ...executor.tools()],
    });
    const parent = created.session;
    allRoots.push(parent);
    parent.setSdkPermissionMode(provider ? 'prompt' : 'allow');
    parent.setSdkPermissionProvider(provider);
    if (!manager.getEntries().some((entry: { type: string }) => entry.type === 'message')) {
      manager.appendMessage({ role: 'user', content: 'Offline fixture root.', timestamp: Date.now() });
      manager.appendMessage(answer('Offline parent.'));
      await manager.flush();
    }
    return { parent, executor };
  };
  const current = await createParent();
  return { ...current, base, root, calls, children, childInputs, createParent, authStorage, registry, settings, credential,
    browserCalls: () => browserCalls,
    async close() {
      await Promise.all(executors.map((executor) => executor.dispose()));
      for (const session of allRoots) await session.dispose();
      await registry.dispose(); authStorage.close(); await settings.close();
      unregisterCustomApis(root);
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function tool(session: Session, name: string, params: unknown, signal?: AbortSignal): Promise<Snapshot[]> {
  const selected = session.getToolForExecution(name);
  assert.ok(selected, `missing ${name}`);
  const output = await selected.execute(`test-${name}`, params, signal);
  return (output.details as { subagents: Snapshot[] }).subagents;
}

function task(assignment = 'Offline assignment.') {
  return { agent: 'executor', tasks: [{ id: 'test', description: 'Contract task', assignment }] };
}

test('real SDK children retain parent permissions, exact Astra identity and app-owned tools', { timeout: 30_000 }, async () => {
  const permissions: string[] = [];
  const f = await fixture((context) => {
    if (context.messages.some((message) => message.role === 'toolResult')) return stream(answer());
    const output = answer();
    output.stopReason = 'toolUse';
    output.content = [
      { type: 'toolCall', id: 'denied-bash', name: 'bash', arguments: { command: 'printf delegation-bypass-canary' } },
      { type: 'toolCall', id: 'app-browser', name: 'browser', arguments: { action: 'open' } },
      { type: 'toolCall', id: 'app-override', name: 'app_probe', arguments: {} },
    ];
    return stream(output);
  }, async (call) => {
    permissions.push(call.toolName);
    return call.toolName === 'task'
      ? { outcome: 'selected', optionId: 'allow_once', kind: 'allow_once' }
      : { outcome: 'selected', optionId: 'reject_once', kind: 'reject_once' };
  });
  try {
    f.parent.settings.override('task.agentModelOverrides', { executor: 'unavailable/unsafe' });
    await assert.rejects(f.parent.getToolForExecution('bash')!.execute('parent-denied', { command: 'printf delegation-bypass-canary' }), /rejected/);
    const [started] = await tool(f.parent, 'task', task());
    const [settled] = await tool(f.parent, 'subagent', { action: 'await', id: started!.id });
    assert.equal(settled!.status, 'completed', JSON.stringify(settled));
    assert.equal(f.browserCalls(), 1);
    assert.deepEqual(permissions, ['bash', 'task', 'bash']);
    assert.ok(f.calls.length >= 2);
    const tools = f.calls[0]!.context.tools!.map((item) => item.name);
    assert.deepEqual(new Set(tools), new Set(f.base.toolNames));
    const results = f.calls.at(-1)!.context.messages.filter((message) => message.role === 'toolResult');
    assert.ok(results.some((message) => message.toolCallId === 'denied-bash' && message.isError));
    assert.ok(results.some((message) => !message.isError && JSON.stringify(message.content).includes('app-override-canary')));
    assert.equal(f.childInputs[0]!.automationTools, f.base.automationTools);
    assert.equal(f.childInputs[0]!.spawns, 'deny');
    assert.ok(!f.childInputs[0]!.toolNames!.includes('task'));
    assert.equal(f.children[0]!.sessionManager.getSessionId(), f.children[0]!.agent.sessionId);
    assert.notEqual(f.children[0]!.credentialSessionId, f.parent.credentialSessionId);
    assert.equal(f.children[0]!.isDisposed, true);
  } finally { await f.close(); }
});

test('saved children resume only under their owning parent with freshly applied policy', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const [started] = await tool(f.parent, 'task', task());
    await tool(f.parent, 'subagent', { action: 'await', id: started!.id });
    const childId = f.children[0]!.sessionManager.getSessionId();
    const stranger = await f.createParent();
    await assert.rejects(tool(stranger.parent, 'subagent', { action: 'resume', id: started!.id, message: 'Steal child' }), /not owned/);
    const parentFile = f.parent.sessionManager.getSessionFile()!;
    await f.executor.dispose();
    await f.parent.dispose();
    const manager = await SessionManager.open(parentFile, f.parent.sessionManager.getSessionDir());
    f.base.toolNames = f.base.toolNames!.filter((name) => name !== 'browser');
    const resumed = await f.createParent(manager);
    resumed.parent.setSdkPermissionMode('deny');
    await assert.rejects(tool(resumed.parent, 'subagent', { action: 'resume', id: started!.id, message: 'Denied follow-up' }), /permission policy/);
    resumed.parent.setSdkPermissionMode('allow');
    await tool(resumed.parent, 'subagent', { action: 'resume', id: started!.id, message: 'Continue the saved assignment.' });
    const [settled] = await tool(resumed.parent, 'subagent', { action: 'await', id: started!.id });
    assert.equal(settled!.status, 'completed', JSON.stringify(settled));
    assert.equal(f.children[1]!.sessionManager.getSessionId(), childId);
    assert.ok(f.calls.at(-1)!.context.messages.filter((message) => message.role === 'user').length >= 2);
    assert.equal(f.children[1]!.thinkingLevel, 'xhigh');
    assert.ok(!f.children[1]!.getActiveToolNames().includes('browser'));
  } finally { await f.close(); }
});

test('denied delegation, role widening and unsupported SDK controls fail before creating children', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    f.parent.setSdkPermissionMode('deny');
    await assert.rejects(tool(f.parent, 'task', task()), /permission policy/);
    f.parent.setSdkPermissionMode('allow');
    f.base.spawns = 'planner';
    await assert.rejects(tool(f.parent, 'task', task()), /role is not allowed/);
    f.base.spawns = '*';
    await assert.rejects(tool(f.parent, 'task', { ...task(), model: 'other/model' }));
    await assert.rejects(tool(f.parent, 'subagent', { action: 'pause' }));
    assert.equal(f.childInputs.length, 0);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('concurrency is bounded across the tree and parent disposal aborts every real SDK child', { timeout: 30_000 }, async () => {
  const began = deferred();
  let count = 0;
  let aborted = 0;
  const f = await fixture((_context, options) => {
    const events = new AssistantMessageEventStream();
    if (++count === 4) began.resolve();
    const cancel = () => {
      aborted += 1;
      const output = answer(); output.stopReason = 'aborted';
      events.push({ type: 'error', reason: 'aborted', error: output }); events.end(output);
    };
    if (options?.signal?.aborted) cancel();
    else options?.signal?.addEventListener('abort', cancel, { once: true });
    return events;
  });
  try {
    await tool(f.parent, 'task', { ...task(), tasks: Array.from({ length: 4 }, (_, id) => ({ ...task().tasks[0], id: String(id) })) });
    await assert.rejects(tool(f.parent, 'task', task()), /concurrency limit/);
    await began.promise;
    await assert.rejects(tool(f.children[0]!, 'task', task()), /concurrency limit/);
    await f.executor.dispose();
    assert.equal(aborted, 4);
    assert.equal(f.children.every((session) => !session.isStreaming), true);
    assert.equal(f.children.every((session) => session.isDisposed), true);
    assert.equal(count, 4);
    await assert.rejects(tool(f.parent, 'task', task()), /cancelled/);
  } finally { await f.close(); }
});

test('automation lock spans parent/child tools and skips cancelled queued calls', async () => {
  const release = deferred();
  const entered = deferred();
  const executions: string[] = [];
  const automation = serializeGjcDelegationAutomationTools({ browser: {
    name: 'browser', label: 'Browser', description: 'Fixture', parameters: z.object({}),
    execute: async (id: string) => {
      executions.push(id); entered.resolve();
      await release.promise;
      return { content: [{ type: 'text', text: id }] };
    },
  } });
  const first = automation.browser!.execute('parent', {});
  await entered.promise;
  const controller = new AbortController();
  const child = automation.browser!.execute('child', {}, controller.signal);
  controller.abort();
  release.resolve();
  await first;
  await assert.rejects(child, /cancelled/);
  assert.deepEqual(executions, ['parent']);
});

test('nested children have direct ownership, bounded depth and cascading cancellation', { timeout: 30_000 }, async () => {
  const first = deferred();
  const second = deferred();
  let count = 0;
  let aborted = 0;
  const f = await fixture((_context, options) => {
    if (++count === 1) first.resolve(); else second.resolve();
    const events = new AssistantMessageEventStream();
    const cancel = () => {
      aborted += 1;
      const output = answer(); output.stopReason = 'aborted';
      events.push({ type: 'error', reason: 'aborted', error: output }); events.end(output);
    };
    options?.signal?.addEventListener('abort', cancel, { once: true });
    return events;
  });
  try {
    const [child] = await tool(f.parent, 'task', task());
    await first.promise;
    const [grandchild] = await tool(f.children[0]!, 'task', task());
    await second.promise;
    await assert.rejects(tool(f.parent, 'subagent', { action: 'inspect', id: grandchild!.id }), /not owned/);
    await assert.rejects(tool(f.children[0]!, 'subagent', { action: 'inspect', id: child!.id }), /not owned/);
    await assert.rejects(tool(f.children[1]!, 'task', task()), /depth limit/);
    const [cancelled] = await tool(f.parent, 'subagent', { action: 'cancel', id: child!.id });
    assert.equal(cancelled!.status, 'cancelled');
    assert.equal(aborted, 2);
    assert.equal(f.calls.length, 2);
  } finally { await f.close(); }
});

test('disposal during public SDK setup waits for the late session and never prompts it', { timeout: 30_000 }, async () => {
  const entered = deferred();
  const release = deferred();
  const f = await fixture(undefined, undefined, async (options) => {
    entered.resolve(); await release.promise; return options;
  });
  try {
    await tool(f.parent, 'task', task());
    await entered.promise;
    let finished = false;
    const dispose = f.executor.dispose().then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false);
    release.resolve();
    await dispose;
    assert.equal(f.calls.length, 0);
    assert.equal(f.children.length, 1);
    assert.equal(f.children[0]!.isStreaming, false);
    assert.equal(f.children[0]!.isDisposed, true);
  } finally { release.resolve(); await f.close(); }
});

test('public extension guard rejects tools activated after child bootstrap', { timeout: 30_000 }, async () => {
  let escaped = false;
  const f = await fixture((context) => {
    if (context.messages.some((message) => message.role === 'toolResult')) return stream(answer());
    const output = answer(); output.stopReason = 'toolUse';
    output.content = [{ type: 'toolCall', id: 'rogue-probe', name: 'rogue', arguments: {} }];
    return stream(output);
  }, undefined, (options) => ({ ...options, extensions: [...options.extensions!, (api: ExtensionAPI) => {
    api.registerTool({ name: 'rogue', label: 'Rogue', description: 'Forbidden fixture.', parameters: z.object({}),
      execute: async () => { escaped = true; return { content: [{ type: 'text', text: 'escaped' }] }; } });
    api.on('before_agent_start', async () => {
      const child = f.children.at(-1)!;
      await child.setActiveToolsByName([...child.getActiveToolNames(), 'rogue']);
    });
  }] }));
  try {
    const [child] = await tool(f.parent, 'task', task());
    const [settled] = await tool(f.parent, 'subagent', { action: 'await', id: child!.id });
    assert.equal(settled!.status, 'completed', JSON.stringify(settled));
    assert.equal(escaped, false);
    assert.ok(f.calls[0]!.context.tools?.some((item) => item.name === 'rogue'), 'fixture must activate the forbidden tool');
    assert.ok(f.calls.at(-1)!.context.messages.some((message) => message.role === 'toolResult'
      && message.isError && JSON.stringify(message.content).includes('parent delegation allowlist')), JSON.stringify(f.calls.at(-1)!.context.messages));
  } finally { await f.close(); }
});

test('production adapter replaces SDK task execution and routes child permission asks to the app', { timeout: 30_000 }, async () => {
  const f = await fixture((context) => {
    const isChild = context.systemPrompt?.some((block) => block.includes('You are a delegated executor'));
    const results = context.messages.filter((message) => message.role === 'toolResult');
    const output = answer();
    if (isChild) {
      if (results.length) return stream(output);
      output.content = [{ type: 'toolCall', id: 'adapter-child-bash', name: 'bash', arguments: { command: 'printf adapter-bypass-canary' } }];
    } else if (!results.length) {
      output.content = [{ type: 'toolCall', id: 'adapter-task', name: 'task', arguments: task() }];
    } else if (!results.some((message) => message.toolCallId === 'adapter-await')) {
      output.content = [{ type: 'toolCall', id: 'adapter-await', name: 'subagent', arguments: { action: 'await' } }];
    } else return stream(output);
    output.stopReason = 'toolUse';
    return stream(output);
  });
  const previous = process.env.GJC_RUNTIME_API_KEY;
  process.env.GJC_RUNTIME_API_KEY = 'offline-delegation-credential';
  try {
    const factoryCalls: CreateAgentSessionOptions[] = [];
    const adapter = new GjcBunSdkAdapter(f.authStorage, f.registry, {
      settings: f.settings, generateSessionTitle: async () => null,
      createSessionFactory: async (input) => {
        factoryCalls.push(input!);
        return createAgentSession({ ...input, agentDir: f.base.agentDir,
          enableMcpAutoload: false, enableLsp: false, skipPythonPreflight: true, disableExtensionDiscovery: true,
          skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
        });
      },
    });
    const frames: Array<Record<string, unknown>> = [];
    await adapter.spawnGjc('Run the offline delegated permission probe.', {
      cwd: f.base.cwd, sessionRoot: join(f.root, 'adapter-sessions'), runHandle: 'delegation-adapter',
      modelId: 'openai-codex/gpt-6-astra', effort: 'xhigh',
      credential: { kind: 'runtime-env', envVar: 'GJC_RUNTIME_API_KEY' },
      toolNames: ['TASK', 'Subagent', 'bash'], spawns: '*', bashPolicy: { allowedPrefixes: [] },
      permissions: { mode: 'ask', allowAlways: ['task'] },
    }, { send: (raw) => {
      const message = raw as Record<string, unknown>; frames.push(message);
      if (message.kind === 'permission_request') {
        assert.equal(adapter.resolveGjcToolApproval(message.requestId as string, { allow: false }), true);
      }
    } });
    assert.equal(factoryCalls.length, 2);
    for (const input of factoryCalls) {
      assert.equal(input.spawns, 'deny');
      assert.ok(!input.toolNames!.includes('task'));
      assert.ok(input.customTools!.some((custom) => custom.name === 'task'));
    }
    assert.equal(frames.filter((frame) => frame.kind === 'permission_request').length, 1);
    assert.ok(f.calls.some((call) => call.context.messages.some((message) => message.role === 'toolResult'
      && message.toolCallId === 'adapter-child-bash' && message.isError)));
  } finally {
    if (previous === undefined) delete process.env.GJC_RUNTIME_API_KEY; else process.env.GJC_RUNTIME_API_KEY = previous;
    await f.close();
  }
});

test('children pin the parent’s actual stored account and resume with its new account', { timeout: 30_000 }, async () => {
  const f = await fixture(undefined, undefined, undefined, true);
  try {
    const rows: Array<{ id: number; provider: string }> = f.authStorage.exportSnapshot().credentials;
    const [first, second] = rows.filter((row) => row.provider === 'openai-codex').sort((a, b) => a.id - b.id);
    assert.ok(first && second);
    await f.parent.setCredentialPin('openai-codex', { kind: 'id', value: String(first.id) });
    const [started] = await tool(f.parent, 'task', task());
    const [initial] = await tool(f.parent, 'subagent', { action: 'await', id: started!.id });
    assert.equal(initial!.status, 'completed', JSON.stringify(initial));
    assert.equal(f.childInputs[0]!.credentialSelector?.selector.value, String(first.id));
    await f.parent.setCredentialPin('openai-codex', { kind: 'id', value: String(second.id) });
    f.credential.expected = 'offline-account-b';
    await tool(f.parent, 'subagent', { action: 'resume', id: started!.id, message: 'Use current pinned credentials.' });
    const [resumed] = await tool(f.parent, 'subagent', { action: 'await', id: started!.id });
    assert.equal(resumed!.status, 'completed', JSON.stringify(resumed));
    assert.equal(f.childInputs[1]!.credentialSelector?.selector.value, String(second.id));
    assert.equal(f.authStorage.resolveEffectiveCredentialSelector('openai-codex', f.parent.credentialSessionId)?.value, String(second.id),
      'child disposal must not release the parent credential scope');
    assert.ok(f.calls.length >= 2);
  } finally { await f.close(); }
});

test('typed Ultragoal red-team instructions survive resume without enabling child goal mode', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const [child] = await tool(f.parent, 'task', { ...task(), tasks: [{ ...task().tasks[0], executionMode: 'ultragoal-red-team' }] });
    const [initial] = await tool(f.parent, 'subagent', { action: 'await', id: child!.id });
    assert.equal(initial!.status, 'completed');
    await tool(f.parent, 'subagent', { action: 'resume', id: child!.id, message: 'Continue the same QA mode.' });
    const [resumed] = await tool(f.parent, 'subagent', { action: 'await', id: child!.id });
    assert.equal(resumed!.status, 'completed');
    for (const call of f.calls) {
      assert.ok(call.context.systemPrompt?.some((block) => block.includes('<ultragoal_red_team_mode>')));
      assert.ok(!call.context.tools?.some((selected) => selected.name === 'goal'));
    }
    for (const session of f.children) assert.equal(session.settings.get('goal.enabled'), false);
  } finally { await f.close(); }
});
