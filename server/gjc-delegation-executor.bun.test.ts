import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { createAgentSession, discoverAuthStorage, type CreateAgentSessionOptions } from '@gajae-code/coding-agent/sdk/session';
import { ModelRegistry } from '@gajae-code/coding-agent/config/model-registry';
import { Settings } from '@gajae-code/coding-agent/config/settings';
import { SessionManager } from '@gajae-code/coding-agent/session/session-manager';
import { runNativeRalplanCommand } from '@gajae-code/coding-agent/gjc-runtime/ralplan-runtime';
import { getUltragoalPaths, readUltragoalLedger, validateUltragoalQualityGateReadOnly } from '@gajae-code/coding-agent/gjc-runtime/ultragoal-runtime';
import { isUltragoalAskBlocked, verifyUltragoalDurableCompletionState } from '@gajae-code/coding-agent/gjc-runtime/ultragoal-guard';
import { captureRepositoryBinding } from '@gajae-code/coding-agent/gjc-runtime/repository-binding';
import { buildSkillStopOutput } from '@gajae-code/coding-agent/hooks/skill-state';
import { readVisibleSkillActiveState } from '@gajae-code/coding-agent/skill-state/active-state';
import type { ExtensionAPI } from '@gajae-code/coding-agent/extensibility/extensions/types';
import { registerCustomApi, unregisterCustomApis } from '@gajae-code/ai/api-registry';
import { AssistantMessageEventStream } from '@gajae-code/ai/utils/event-stream';
import { convertOpenAICodexResponsesTools } from '@gajae-code/ai/providers/openai-codex-responses';
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from '@gajae-code/ai/types';
import * as z from 'zod/v4';

import { GjcDelegationExecutor, serializeGjcDelegationAutomationTools } from './gjc-delegation-executor.js';
import type { GjcPermissionProvider } from './gjc-bun-permission-gate.js';
import { GjcBunSdkAdapter } from './gjc-bun-sdk-adapter.js';
import { installGjcCliShim } from './gjc-cli-shim.js';

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
  execFileSync('git', ['init', '-q'], { cwd });
  await writeFile(join(cwd, '.gitignore'), '.gjc/\nartifacts/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd });
  execFileSync('git', ['-c', 'user.name=Offline fixture', '-c', 'user.email=fixture@invalid',
    'commit', '-qm', 'Initialize offline fixture'], { cwd });
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
  const transportErrors: unknown[] = [];
  registerCustomApi(API, (selected, context, options) => {
    assert.equal(selected.provider, 'openai-codex');
    assert.equal(selected.id, 'gpt-6-astra');
    assert.equal(options?.reasoning, 'xhigh');
    assert.equal(options?.apiKey, credential.expected);
    calls.push({ model: selected, context, options });
    try { return respond(context, options); }
    catch (error) { transportErrors.push(error); throw error; }
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
  return { ...current, base, root, calls, children, childInputs, createParent, authStorage, registry, settings, credential, transportErrors,
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

test('delegated work obeys the actual parent native planning mutation guard', { timeout: 30_000 }, async () => {
  const command = "printf changed > product.txt";
  const f = await fixture((context) => {
    if (context.messages.some((message) => message.role === 'toolResult')) return stream(answer());
    const output = answer(); output.stopReason = 'toolUse';
    output.content = [{ type: 'toolCall', id: 'planning-mutation', name: 'bash', arguments: { command } }];
    return stream(output);
  });
  try {
    const cwd = f.base.cwd!;
    await writeFile(join(cwd, 'product.txt'), 'original');
    const seed = await runNativeRalplanCommand(['--session-id', f.parent.sessionManager.getSessionId(), '--json', 'Plan a small change.'], cwd,
      { agentDir: f.base.agentDir });
    assert.equal(seed.status, 0, seed.stderr);
    await assert.rejects(f.parent.getToolForExecution('bash')!.execute('parent-planning-mutation', { command }), /Ralplan planning phase boundary/);
    const [child] = await tool(f.parent, 'task', task('Inspect the assigned product.'));
    await tool(f.parent, 'subagent', { action: 'await', id: child!.id });
    assert.equal(await readFile(join(cwd, 'product.txt'), 'utf8'), 'original');
    assert.ok(f.calls.at(-1)!.context.messages.some((message) => message.role === 'toolResult' && message.isError
      && JSON.stringify(message.content).includes('Ralplan planning phase boundary')));
  } finally { await f.close(); }
});

test('grandchildren obey root planning guards activated after their direct owner started', { timeout: 30_000 }, async () => {
  const began = deferred();
  const command = 'printf changed > product.txt';
  const f = await fixture((context, options) => {
    if (context.messages.some((message) => message.role === 'user' && messageText(message).includes('Hold the direct owner open.'))) {
      const events = new AssistantMessageEventStream();
      options?.signal?.addEventListener('abort', () => {
        const output = answer(); output.stopReason = 'aborted';
        events.push({ type: 'error', reason: 'aborted', error: output }); events.end(output);
      }, { once: true });
      began.resolve();
      return events;
    }
    if (context.messages.some((message) => message.role === 'toolResult')) return stream(answer());
    const output = answer(); output.stopReason = 'toolUse';
    output.content = [{ type: 'toolCall', id: 'nested-mutation', name: 'bash', arguments: { command } }];
    return stream(output);
  });
  try {
    const cwd = f.base.cwd!;
    await writeFile(join(cwd, 'product.txt'), 'original');
    const [child] = await tool(f.parent, 'task', task('Hold the direct owner open.'));
    await began.promise;
    const seed = await runNativeRalplanCommand(['--session-id', f.parent.sessionManager.getSessionId(), '--json', 'Plan without mutation.'], cwd,
      { agentDir: f.base.agentDir });
    assert.equal(seed.status, 0, seed.stderr);
    const owner = f.children[0]!;
    assert.equal(await readVisibleSkillActiveState(cwd, owner.sessionManager.getSessionId()), null);
    const [grandchild] = await tool(owner, 'task', task('Inspect the product.'));
    const [settled] = await tool(owner, 'subagent', { action: 'await', id: grandchild!.id });
    assert.equal(settled!.status, 'completed');
    assert.equal(await readFile(join(cwd, 'product.txt'), 'utf8'), 'original');
    assert.ok(f.calls.at(-1)!.context.messages.some((message) => message.role === 'toolResult' && message.isError
      && messageText(message).includes('Ralplan planning phase boundary')));
    await tool(f.parent, 'subagent', { action: 'cancel', id: child!.id });
  } finally { await f.close(); }
});

test('declared repository drift is rejected before delegation authorization or child creation', { timeout: 30_000 }, async () => {
  let permissions = 0;
  const f = await fixture(undefined, async () => {
    permissions += 1;
    return { outcome: 'selected', optionId: 'allow_once' };
  });
  try {
    const sibling = join(f.root, 'sibling');
    await mkdir(sibling);
    execFileSync('git', ['init', '-q'], { cwd: sibling });
    const binding = await captureRepositoryBinding(sibling);
    await assert.rejects(tool(f.parent, 'task', { ...task(), tasks: [{ ...task().tasks[0], repositoryBinding: binding }] }),
      { name: 'RepositoryBindingError', code: 'identity_mismatch' });
    const ownBinding = await captureRepositoryBinding(f.base.cwd!);
    await assert.rejects(tool(f.parent, 'task', { ...task(), tasks: [{ ...task().tasks[0],
      repositoryBinding: { ...ownBinding, relativeSubdir: '../sibling' } }] }), /relativeSubdir/);
    assert.equal(permissions, 0);
    assert.equal(f.childInputs.length, 0);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('disposal during repository resolution cannot request delegation approval', { timeout: 30_000 }, async () => {
  let permissions = 0;
  const f = await fixture(undefined, async () => {
    permissions += 1;
    return { outcome: 'selected', optionId: 'allow_once' };
  });
  try {
    // Call the app tool directly so it synchronously reaches the first await
    // (repository resolution), without an earlier SDK wrapper yielding first.
    const selected = f.executor.tools().find((item) => item.name === 'task')!;
    const pending = selected.execute('binding-disposal', task(), undefined, {
      sessionManager: f.parent.sessionManager, modelRegistry: f.registry, model: f.parent.model,
      isIdle: () => true, hasQueuedMessages: () => false, abort: () => {},
    });
    const rejected = assert.rejects(pending, /cancelled/);
    await f.executor.dispose();
    await rejected;
    assert.equal(permissions, 0);
    assert.equal(f.childInputs.length, 0);
  } finally { await f.close(); }
});

function messageText(message: { content: unknown }): string {
  if (typeof message.content === 'string') return message.content;
  return Array.isArray(message.content)
    ? message.content.map((block) => block.type === 'text' ? block.text : '').join('\n') : '';
}

function jsonOutput(text: string): Record<string, any> {
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
  catch (cause) { throw new Error(`Invalid native fixture JSON: ${text}`, { cause }); }
}

function shellArg(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

test('native Ralplan consumes app-owned role artifacts and resumed review lanes without approval fabrication', { timeout: 60_000 }, async () => {
  type Assignment = { role: 'planner' | 'architect' | 'critic'; stage: string; pass: number; owner: string; run: string; source: string; worktree: string };
  let toolPath = '';
  const independentlyRead = new Map<string, string[]>();
  const f = await fixture((context) => {
    const assignmentText = context.messages.filter((message) => message.role === 'user').map(messageText).reverse()
      .map((text) => /\[app-workflow-fixture\]\n([^\n]+)\n/.exec(text)?.[1]).find(Boolean);
    assert.ok(assignmentText, JSON.stringify(context.messages));
    const assignment = JSON.parse(assignmentText) as Assignment;
    const id = /App delegation id: ([a-f0-9-]+)/.exec(context.systemPrompt!.join('\n'))?.[1];
    assert.ok(id, 'the actual app child ID must be available to the role writer');
    const readId = `native-read-${assignment.pass}`;
    const persistId = `native-write-${assignment.pass}`;
    const receiptReadId = `native-receipt-${assignment.pass}`;
    const result = context.messages.filter((message) => message.role === 'toolResult');
    const read = result.find((message) => message.toolCallId === readId);
    const persisted = result.find((message) => message.toolCallId === persistId);
    const receiptRead = result.find((message) => message.toolCallId === receiptReadId);
    const output = answer();
    if (!read) {
      output.stopReason = 'toolUse';
      output.content = [{ type: 'toolCall', id: readId, name: 'read', arguments: { path: assignment.source } }];
    } else if (!persisted) {
      assert.equal(read.isError, false);
      const inspected = messageText(read);
      independentlyRead.set(id, [...(independentlyRead.get(id) ?? []), assignment.source]);
      // This deterministic reviewer decides from a real SDK read result, not
      // from a prewritten approval receipt or the leader's requested verdict.
      const safe = inspected.includes('deny remains denied') && inspected.includes('test the child policy');
      const verdict = assignment.role === 'critic' ? (safe ? 'OKAY' : 'REJECT') : (safe ? 'CLEAR' : 'BLOCK');
      const artifact = assignment.role === 'planner'
        ? `# Policy preservation plan\n\nSource reviewed: ${assignment.source}\n\n- Preserve the invariant: deny remains denied.\n- Explicitly test the child policy.\n- Compare inherited gates with disabled delegation; retain inherited gates for useful bounded work.\n`
        : `# ${assignment.role} independent review\n\nSource reviewed: ${assignment.source}\n\nVerdict: ${verdict}\n\n${safe ? 'Both required policy obligations were found in the inspected plan.' : 'The inspected plan is missing a required policy obligation.'}\n`;
      const args = ['gjc', 'ralplan', '--write', '--worktree-root', assignment.worktree, '--session-id', assignment.owner,
        '--run-id', assignment.run, '--stage', assignment.stage, '--stage_n', String(assignment.pass),
        '--artifact-env', 'GJC_RALPLAN_ARTIFACT', `--${assignment.role}-id`, id, `--${assignment.role}-resumable`, 'true',
        ...(assignment.role === 'planner' ? [] : ['--lane-verdict', verdict]), '--json'];
      output.stopReason = 'toolUse';
      output.content = [{ type: 'toolCall', id: persistId, name: 'bash', arguments: {
        command: args.map(shellArg).join(' '), env: { PATH: toolPath, GJC_RALPLAN_ARTIFACT: artifact },
      } }];
    } else {
      assert.equal(persisted.isError, false, messageText(persisted));
      const artifact = /Read (artifact:\/\/\S+) for full output/.exec(messageText(persisted))?.[1];
      if (artifact && !receiptRead) {
        output.stopReason = 'toolUse';
        output.content = [{ type: 'toolCall', id: receiptReadId, name: 'read', arguments: { path: `${artifact}:raw` } }];
      } else {
        const raw = messageText(receiptRead ?? persisted).replace(/^\d+#[A-Z0-9]+[:|]/gm, '');
        const receipt = jsonOutput(raw);
        assert.equal(receipt.session_id, assignment.owner);
        assert.equal(receipt.stage, assignment.stage);
        output.content = [{ type: 'text', text: JSON.stringify(receipt) }];
      }
    }
    return stream(output);
  });
  try {
    const cwd = f.base.cwd!;
    await writeFile(join(cwd, 'requirements.md'), 'Invariant: deny remains denied. Verification: test the child policy.\n');
    const environment = { ...process.env };
    assert.ok(installGjcCliShim({ env: environment, homeDir: f.root, bunPath: process.execPath }));
    toolPath = environment.PATH!;
    const owner = f.parent.sessionManager.getSessionId();
    const seed = await runNativeRalplanCommand(['--worktree-root', cwd, '--session-id', owner, '--json', 'Plan policy preservation.'], cwd,
      { agentDir: f.base.agentDir });
    assert.equal(seed.status, 0, seed.stderr);
    const run = jsonOutput(seed.stdout!).run_id as string;
    const assignment = (role: Assignment['role'], stage: string, pass: number, source: string) =>
      `[app-workflow-fixture]\n${JSON.stringify({ role, stage, pass, source, owner, run, worktree: cwd } satisfies Assignment)}\n[/app-workflow-fixture]`;
    const launch = async (role: Assignment['role'], stage: string, pass: number, source: string) => {
      const [child] = await tool(f.parent, 'task', { agent: role, tasks: [{ id: role, description: `${role} review`,
        repositoryBinding: jsonOutput(seed.stdout!).repository_binding, assignment: assignment(role, stage, pass, source) }] });
      return child!.id;
    };
    const collect = async (id: string) => {
      const [child] = await tool(f.parent, 'subagent', { action: 'await', id });
      assert.equal(child!.status, 'completed', JSON.stringify({ child, errors: f.transportErrors.map(String) }));
      const receipt = jsonOutput(child!.resultText);
      assert.equal(receipt.session_id, owner);
      assert.equal(receipt.run_id, run);
      assert.equal(createHash('sha256').update(await readFile(receipt.path)).digest('hex'), receipt.sha256);
      return receipt;
    };
    const planner = await launch('planner', 'planner', 1, join(cwd, 'requirements.md'));
    const firstPlan = await collect(planner);
    const [architect, critic] = await Promise.all([
      launch('architect', 'architect', 1, firstPlan.path), launch('critic', 'critic', 1, firstPlan.path),
    ]);
    const [archReceipt, criticReceipt] = await Promise.all([collect(architect), collect(critic)]);
    assert.equal(archReceipt.lane_verdict.verdict, 'CLEAR');
    assert.equal(criticReceipt.lane_verdict.verdict, 'OKAY');
    await tool(f.parent, 'subagent', { action: 'resume', id: planner,
      message: assignment('planner', 'revision', 2, join(cwd, 'requirements.md')) });
    const revised = await collect(planner);
    // Native pass-2 rules reuse the same IDs and run Architect before Critic.
    await tool(f.parent, 'subagent', { action: 'resume', id: architect,
      message: assignment('architect', 'architect', 2, revised.path) });
    await collect(architect);
    await tool(f.parent, 'subagent', { action: 'resume', id: critic,
      message: assignment('critic', 'critic', 2, revised.path) });
    await collect(critic);
    const rows = (await readFile(join(dirname(revised.path), 'index.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(rows.length, 6);
    assert.deepEqual(new Set(rows.map((row) => `${row.stage}:${row.stage_n}`)),
      new Set(['planner:1', 'architect:1', 'critic:1', 'revision:2', 'architect:2', 'critic:2']));
    const state = JSON.parse(await readFile(jsonOutput(seed.stdout!).state_path, 'utf8'));
    assert.equal(state.planner_subagent_id, planner);
    assert.equal(state.architect_id, architect);
    assert.equal(state.critic_id, critic);
    assert.notEqual(planner, architect); assert.notEqual(architect, critic);
    assert.deepEqual(independentlyRead.get(architect), [firstPlan.path, revised.path]);
    assert.deepEqual(independentlyRead.get(critic), [firstPlan.path, revised.path]);
    assert.equal(new Set(f.childInputs.slice(0, 3).map((input) => input.sessionManager!.getSessionId())).size, 3);
    assert.equal(f.childInputs[0]!.currentAgentType, 'planner');
    assert.deepEqual(new Set(f.childInputs.slice(1, 3).map((input) => input.currentAgentType)), new Set(['architect', 'critic']));
    assert.deepEqual(f.childInputs.slice(3).map((input) => input.currentAgentType), ['planner', 'architect', 'critic']);
    assert.ok(f.parent.sessionManager.getEntries().some((entry: { type: string; customType?: string }) =>
      entry.type === 'custom' && entry.customType === 'gajae-app.delegation.v1'));
    assert.equal((await readVisibleSkillActiveState(cwd, owner))?.skill, 'ralplan');
    const stop = await buildSkillStopOutput({ cwd, sessionId: owner, sessionFile: f.parent.sessionManager.getSessionFile() });
    assert.equal(stop?.decision, 'block', 'independent reviews do not fabricate the user handoff/approval');
    const duplicate = await runNativeRalplanCommand(['--write', '--worktree-root', cwd, '--session-id', owner, '--run-id', run,
      '--stage', 'critic', '--stage_n', '2', '--artifact', 'Replace existing review with different content.', '--json'], cwd,
    { agentDir: f.base.agentDir });
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr!, /refusing to overwrite/);
  } finally { await f.close(); }
});

async function nativeBash(session: Session, command: string, env: Record<string, string>) {
  const output = await session.getToolForExecution('bash')!.execute('native-owner-command', { command, env });
  const text = messageText(output);
  const artifact = /Read (artifact:\/\/\S+) for full output/.exec(text)?.[1];
  if (!artifact) return text;
  const full = await session.getToolForExecution('read')!.execute('native-owner-receipt', { path: `${artifact}:raw` });
  return messageText(full).replace(/^\d+#[A-Z0-9]+[:|]/gm, '');
}

test('delegated ask cannot escape the owner Ultragoal guard through a distinct child session', { timeout: 30_000 }, async () => {
  let asks = 0;
  const f = await fixture((context) => {
    if (context.messages.some((message) => message.role === 'toolResult')) return stream(answer());
    const output = answer(); output.stopReason = 'toolUse';
    output.content = [{ type: 'toolCall', id: 'delegated-ask', name: 'ask', arguments: {} }];
    return stream(output);
  });
  try {
    f.base.toolNames!.push('ask');
    f.base.customTools!.push({ name: 'ask', label: 'Ask', description: 'Observable ask fixture.', parameters: z.object({}),
      execute: async () => { asks += 1; return { content: [{ type: 'text', text: 'User question reached.' }] }; },
    });
    const { parent } = await f.createParent();
    const environment = { ...process.env };
    assert.ok(installGjcCliShim({ env: environment, homeDir: f.root, bunPath: process.execPath }));
    const created = jsonOutput(await nativeBash(parent, 'gjc ultragoal create-goals --brief "Keep work in the owner workflow" --json',
      { PATH: environment.PATH! }));
    assert.equal(created.ok, true);
    assert.equal((await isUltragoalAskBlocked(f.base.cwd!, { sessionId: parent.sessionManager.getSessionId() })).active, true);
    const [child] = await tool(parent, 'task', task('Inspect the scope without asking the user.'));
    const [settled] = await tool(parent, 'subagent', { action: 'await', id: child!.id });
    assert.equal(settled!.status, 'completed');
    assert.equal((await isUltragoalAskBlocked(f.base.cwd!, { sessionId: f.children[0]!.sessionManager.getSessionId() })).active, false);
    assert.equal(asks, 0);
    assert.ok(f.calls.at(-1)!.context.messages.some((message) => message.role === 'toolResult' && message.isError
      && /ultragoal/i.test(messageText(message))));
  } finally { await f.close(); }
});

test('native Ultragoal validates independently produced app-lane evidence and creates its own completion receipt', { timeout: 60_000 }, async () => {
  type Lane = 'cleaner' | 'architect' | 'qa' | 'critic';
  type Assignment = { lane: Lane; source: string; sourceHash: string; cwd: string };
  const invocation = `bun -e "console.log('native-receipt-probe')"`;
  const expectedStdout = 'native-receipt-probe\n';
  const inspectedByLane = new Set<Lane>();
  let toolPath = '';
  const f = await fixture((context) => {
    const assignmentText = context.messages.filter((message) => message.role === 'user').map(messageText).reverse()
      .map((text) => /\[app-workflow-fixture\]\n([^\n]+)\n/.exec(text)?.[1]).find(Boolean);
    assert.ok(assignmentText);
    const assignment = JSON.parse(assignmentText) as Assignment;
    const results = context.messages.filter((message) => message.role === 'toolResult');
    const read = results.find((message) => message.toolCallId === 'lane-read');
    const run = results.find((message) => message.toolCallId === 'lane-run');
    const proof = results.find((message) => message.toolCallId === 'lane-proof');
    const output = answer();
    const request = (id: string, name: string, args: Record<string, unknown>) => {
      output.stopReason = 'toolUse';
      output.content = [{ type: 'toolCall', id, name, arguments: args }];
      return stream(output);
    };
    if (!read) return request('lane-read', 'read', { path: `${assignment.source}:raw` });
    assert.equal(read.isError, false, messageText(read));
    const inspected = messageText(read);
    inspectedByLane.add(assignment.lane);
    if (assignment.lane === 'critic') {
      const joined = jsonOutput(inspected);
      const lanes = joined.iteration.reviewCohort.lanes;
      const accepted = joined.iteration.reviewCohort.joined === true
        && ['cleaner', 'architect', 'qa'].every((lane) => lanes[lane].sourceHash === assignment.sourceHash && lanes[lane].blockers.length === 0);
      output.content = [{ type: 'text', text: JSON.stringify({ criticReview: {
        verdict: accepted ? 'OKAY' : 'REJECT', sourceHash: assignment.sourceHash,
        evidence: `Independently read ${assignment.source}; checked all three lane hashes and blocker lists.`,
        blockers: accepted ? [] : ['The cohort was not joined on one source.'],
      } }) }];
      return stream(output);
    }
    assert.ok(inspected.includes("console.log('native-receipt-probe')"), 'reviewers must inspect the actual accepted invocation');
    if (!run) return request('lane-run', 'bash', { command: invocation, env: { PATH: toolPath } });
    assert.equal(run.isError, false, messageText(run));
    assert.equal(messageText(run), expectedStdout, 'lane verdicts require a real matching command result');
    if (assignment.lane === 'qa' && !proof) {
      return request('lane-proof', 'write', { path: 'artifacts/qa-replay.json', content: JSON.stringify({
        schemaVersion: 1, kind: 'cli-replay', replaySafe: true,
        command: ['bun', '-e', "console.log('native-receipt-probe')"], cwd: assignment.cwd, env: {},
        timeoutMs: 30000, expectedExitCode: 0, recordedStdout: messageText(run), recordedStderr: '',
        invariants: [{ type: 'substring', value: 'native-receipt-probe' }, { type: 'not_substring', value: 'secret' }],
      }) });
    }
    if (proof) assert.equal(proof.isError, false, messageText(proof));
    const evidence = `Independent ${assignment.lane} inspected ${assignment.source}, executed ${invocation}, and observed ${messageText(run).trim()}.`;
    const lane = { status: assignment.lane === 'architect' ? 'CLEAR' : 'passed', sourceHash: assignment.sourceHash, evidence, blockers: [] };
    const report = assignment.lane === 'architect' ? { architectReview: {
      architectureStatus: 'CLEAR', productStatus: 'CLEAR', codeStatus: 'CLEAR', recommendation: 'APPROVE',
      commands: [invocation], evidence, blockers: [],
    } } : assignment.lane === 'qa' ? { executorQa: {
      status: 'passed', e2eStatus: 'passed', redTeamStatus: 'passed', evidence,
      e2eCommands: [invocation], redTeamCommands: [invocation], blockers: [],
      artifactRefs: [{ id: 'qa-replay', kind: 'cli-replay', path: 'artifacts/qa-replay.json', description: 'Actual command replay with positive and no-secret invariants.' }],
      surfaceEvidence: [{ id: 'cli', surface: 'cli', contractRef: 'fixture-contract', invocation,
        verdict: 'passed', artifactRefs: ['qa-replay'] }],
      adversarialCases: [{ id: 'no-secret', contractRef: 'fixture-contract', scenario: 'Unexpected secret text in stdout',
        expectedBehavior: 'The exact output contains no secret text.', verdict: 'passed', artifactRefs: ['qa-replay'] }],
      contractCoverage: [{ id: 'output-contract', contractRef: 'fixture-contract', obligation: 'Emit the exact expected output without secret text.',
        status: 'covered', surfaceEvidenceRefs: ['cli'], adversarialCaseRefs: ['no-secret'] }],
    } } : {};
    output.content = [{ type: 'text', text: JSON.stringify({ ...report, lane }) }];
    return stream(output);
  });
  try {
    const cwd = f.base.cwd!;
    await writeFile(join(cwd, 'contract.md'), `# Accepted fixture contract\n\nRun ${invocation}. Expected stdout: native-receipt-probe followed by a newline. No secret text may be emitted.\n`);
    execFileSync('git', ['add', 'contract.md'], { cwd });
    execFileSync('git', ['-c', 'user.name=Offline fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'Record fixture contract'], { cwd });
    f.base.toolNames!.push('write');
    const { parent } = await f.createParent();
    const owner = parent.sessionManager.getSessionId();
    const environment = { ...process.env };
    assert.ok(installGjcCliShim({ env: environment, homeDir: f.root, bunPath: process.execPath }));
    toolPath = `${dirname(process.execPath)}:${environment.PATH!}`;
    const env = { PATH: toolPath };
    const create = jsonOutput(await nativeBash(parent, 'gjc ultragoal create-goals --brief "Verify the accepted fixture CLI output contract" --json', env));
    assert.equal(create.ok, true);
    const goalId = create.goal_ids[0] as string;
    await nativeBash(parent, 'gjc ultragoal complete-goals --json', env);
    const sourceHash = jsonOutput(await nativeBash(parent, 'gjc ultragoal quality-gate source-hash --json', env)).sourceHash as string;
    assert.ok(sourceHash);
    const launch = async (lane: Lane, source = join(cwd, 'contract.md')) => {
      const [child] = await tool(parent, 'task', { agent: lane === 'architect' || lane === 'critic' ? lane : 'executor',
        tasks: [{ id: lane, description: `Independent ${lane} lane`,
          ...(lane === 'qa' ? { executionMode: 'ultragoal-red-team' } : {}),
          assignment: `[app-workflow-fixture]\n${JSON.stringify({ lane, source, sourceHash, cwd } satisfies Assignment)}\n[/app-workflow-fixture]`,
        }] });
      return child!.id;
    };
    const ids = await Promise.all([launch('cleaner'), launch('architect'), launch('qa')]);
    const collected = await Promise.all(ids.map(async (id) => {
      const [child] = await tool(parent, 'subagent', { action: 'await', id });
      assert.equal(child!.status, 'completed', JSON.stringify({ child, errors: f.transportErrors.map(String) }));
      return jsonOutput(child!.resultText);
    }));
    const wrapperOnly = await validateUltragoalQualityGateReadOnly({ cwd, sessionId: owner, goalId,
      qualityGateJson: JSON.stringify({ subagents: collected }) });
    assert.equal(wrapperOnly.valid, false, 'completed children are not native completion receipts');
    const rerun = await nativeBash(parent, invocation, env);
    assert.equal(rerun, expectedStdout);
    const gate = {
      architectReview: collected[1]!.architectReview, executorQa: collected[2]!.executorQa,
      iteration: { status: 'passed', fullRerun: true, rerunCommands: [invocation],
        evidence: `Owner reran ${invocation} after joining independent lanes and observed ${rerun.trim()}.`, blockers: [],
        reviewCohort: { reviewGeneration: 1, sourceHash, joined: true,
          lanes: { cleaner: collected[0]!.lane, architect: collected[1]!.lane, qa: collected[2]!.lane } },
      },
    };
    await parent.getToolForExecution('write')!.execute('save-real-lane-join', { path: 'artifacts/joined-evidence.json', content: JSON.stringify(gate) });
    const criticId = await launch('critic', join(cwd, 'artifacts/joined-evidence.json'));
    const [critic] = await tool(parent, 'subagent', { action: 'await', id: criticId });
    assert.equal(critic!.status, 'completed', JSON.stringify({ critic, errors: f.transportErrors.map(String) }));
    const finalGate = { ...gate, ...jsonOutput(critic!.resultText) };
    const validation = await validateUltragoalQualityGateReadOnly({ cwd, sessionId: owner, goalId, qualityGateJson: JSON.stringify(finalGate) });
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
    const unjoined = structuredClone(finalGate); unjoined.iteration.reviewCohort.joined = false;
    const rejected = await validateUltragoalQualityGateReadOnly({ cwd, sessionId: owner, goalId, qualityGateJson: JSON.stringify(unjoined) });
    assert.equal(rejected.valid, false);
    assert.ok(rejected.errors.some((error) => error.message.includes('joined')));
    const replayPath = join(cwd, 'artifacts/qa-replay.json');
    const genuineReplay = await readFile(replayPath, 'utf8');
    const ledgerBeforeValidation = await readFile(getUltragoalPaths(cwd, owner).ledgerPath, 'utf8');
    await parent.getToolForExecution('write')!.execute('tamper-replay-expectation', { path: replayPath,
      content: JSON.stringify({ ...JSON.parse(genuineReplay), expectedExitCode: 7 }) });
    const tampered = await validateUltragoalQualityGateReadOnly({ cwd, sessionId: owner, goalId, qualityGateJson: JSON.stringify(finalGate) });
    assert.equal(tampered.valid, false);
    assert.ok(tampered.errors.some((error) => error.message.includes('CLI replay exit code 0 did not match expected 7')),
      JSON.stringify(tampered.errors));
    assert.equal(await readFile(getUltragoalPaths(cwd, owner).ledgerPath, 'utf8'), ledgerBeforeValidation,
      'read-only validation cannot mint a successful native receipt');
    assert.notEqual((await verifyUltragoalDurableCompletionState({ cwd, sessionId: owner })).state, 'active_verified_complete');
    await parent.getToolForExecution('write')!.execute('restore-real-replay', { path: replayPath, content: genuineReplay });
    const checkpoint = await nativeBash(parent, ['gjc', 'ultragoal', 'checkpoint', '--goal-id', goalId, '--status', 'complete',
      '--evidence', 'Independent lanes inspected the accepted fixture and the runtime replay verified actual stdout.',
      '--quality-gate-json', JSON.stringify(finalGate), '--json'].map(shellArg).join(' '), env);
    assert.ok(checkpoint.includes('complete'), checkpoint);
    const ledger = await readUltragoalLedger(cwd, owner);
    assert.ok(ledger.some((event) => event.event === 'goal_checkpointed' && event.status === 'complete'));
    const diagnostic = await verifyUltragoalDurableCompletionState({ cwd, sessionId: owner });
    assert.equal(diagnostic.state, 'active_verified_complete', JSON.stringify(diagnostic));
    assert.equal((await buildSkillStopOutput({ cwd, sessionId: owner }))?.decision, undefined);
    assert.deepEqual(inspectedByLane, new Set(['cleaner', 'architect', 'qa', 'critic']));
    assert.equal(new Set(f.childInputs.map((input) => input.agentId)).size, 4);
    const plan = JSON.parse(await readFile(getUltragoalPaths(cwd, owner).goalsPath, 'utf8'));
    assert.equal(plan.goals[0].completionVerification.receiptKind, 'final-aggregate');
    for (const child of f.children) assert.equal(child.settings.get('goal.enabled'), false);
  } finally { await f.close(); }
});

test('final Codex provider tool schema permits default Planner work and nullable unused controls', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    // This is the SDK provider's final serializer (exported for SDK contract
    // tests), not Zod's intermediate schema. No network or model call occurs.
    for (const strict of [false, true]) {
      const tools = ['task', 'subagent'].map((name) => {
        const actual = f.parent.getToolByName(name)!;
        return { name: actual.name, description: actual.description, parameters: actual.parameters, strict };
      });
      const serialized = convertOpenAICodexResponsesTools(tools, { ...f.base.model!, api: 'openai-codex-responses' });
      const taskSpec = serialized.find((item) => item.name === 'task')!;
      const controlSpec = serialized.find((item) => item.name === 'subagent')!;
      assert.equal(taskSpec.type, 'function'); assert.equal(controlSpec.type, 'function');
      if (taskSpec.type !== 'function' || controlSpec.type !== 'function') throw new Error('Expected function tools');
      const params = taskSpec.parameters as Record<string, any>;
      const mode = params.properties.tasks.items.properties.executionMode;
      const modeEnum = mode.enum ?? mode.anyOf?.find((variant: { enum?: string[] }) => variant.enum)?.enum;
      assert.deepEqual(modeEnum, ['default', 'ultragoal-red-team'], JSON.stringify({ strict, mode }));
      assert.match(mode.description, /default for Planner/);
      if (strict) {
        assert.equal(taskSpec.strict, true);
        assert.ok(params.properties.tasks.items.required.includes('executionMode'));
        assert.equal(params.additionalProperties, false);
      }
      const allowsNull = (schema: Record<string, any>): boolean => schema.type === 'null'
        || Array.isArray(schema.type) && schema.type.includes('null')
        || Array.isArray(schema.anyOf) && schema.anyOf.some(allowsNull);
      assert.equal(allowsNull(params.properties.context), true);
      const binding = params.properties.tasks.items.properties.repositoryBinding;
      assert.equal(allowsNull(binding), true);
      const bindingObject = binding.properties ? binding : binding.anyOf.find((variant: Record<string, any>) => variant.properties);
      for (const field of ['relativeSubdir', 'displayPath', 'head', 'branch']) {
        assert.equal(allowsNull(bindingObject.properties[field]), true, field);
      }
      for (const field of ['id', 'ids', 'message', 'timeout_ms', 'condition']) {
        assert.equal(allowsNull((controlSpec.parameters as Record<string, any>).properties[field]), true, field);
      }
    }
    const [child] = await tool(f.parent, 'task', { agent: 'planner', context: null,
      tasks: [{ id: 'ordinary-planner', description: 'Ordinary Planner', assignment: 'Inspect only the supplied scope.',
        executionMode: 'default', repositoryBinding: null }] });
    const [settled] = await tool(f.parent, 'subagent', { action: 'await', id: child!.id, ids: null,
      message: null, timeout_ms: 30000, condition: 'all_terminal' });
    assert.equal(settled!.status, 'completed');
    assert.ok(!f.calls[0]!.context.systemPrompt?.some((block) => block.includes('<ultragoal_red_team_mode>')));
    const [nullMode] = await tool(f.parent, 'task', { agent: 'planner', context: null,
      tasks: [{ id: 'nullable-planner', description: 'Nullable ordinary mode', assignment: 'Inspect only the supplied scope.',
        executionMode: null, repositoryBinding: null }] });
    const [nullSettled] = await tool(f.parent, 'subagent', { action: 'await', id: nullMode!.id, ids: null,
      message: null, timeout_ms: 30000, condition: null });
    assert.equal(nullSettled!.status, 'completed');
    assert.ok(!f.calls[1]!.context.systemPrompt?.some((block) => block.includes('<ultragoal_red_team_mode>')));
    const binding = { ...await captureRepositoryBinding(f.base.cwd!), relativeSubdir: null, displayPath: null, head: null, branch: null };
    const [bound] = await tool(f.parent, 'task', { agent: 'planner', context: null,
      tasks: [{ id: 'bound-planner', description: 'Bound Planner', assignment: 'Inspect only the supplied scope.',
        executionMode: 'default', repositoryBinding: binding }] });
    const [boundSettled] = await tool(f.parent, 'subagent', { action: 'await', id: bound!.id });
    assert.equal(boundSettled!.status, 'completed');
    assert.ok(f.calls[2]!.context.systemPrompt?.some((block) => block.includes(binding.worktreeRoot)));
    await assert.rejects(tool(f.parent, 'task', { agent: 'planner', tasks: [{ ...task().tasks[0], executionMode: 'ultragoal-red-team' }] }),
      /Red-team execution mode requires the executor role/);
    assert.equal(f.childInputs.length, 3, 'invalid red-team mode must not create another child');
  } finally { await f.close(); }
});
