import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { createAgentSession, type CreateAgentSessionOptions, type AutomationTools } from '@gajae-code/coding-agent/sdk/session';
import { SessionManager } from '@gajae-code/coding-agent/session/session-manager';
import type { CustomTool } from '@gajae-code/coding-agent/extensibility/custom-tools/types';
import type { AgentSessionEvent } from '@gajae-code/coding-agent/session/agent-session';
import type { ExtensionFactory } from '@gajae-code/coding-agent/extensibility/extensions/types';
import { getBundledAgent } from '@gajae-code/coding-agent/task/agents';
import { taskItemSchema } from '@gajae-code/coding-agent/task/types';
import { resolveTaskRepositoryBinding } from '@gajae-code/coding-agent/gjc-runtime/repository-binding';
import { isUltragoalAskBlocked, consumeUltragoalAskNudge } from '@gajae-code/coding-agent/gjc-runtime/ultragoal-guard';
import { formatUltragoalAskBlockMessage } from '@gajae-code/coding-agent/tools/ultragoal-ask-guard';
import { assertWorkflowMutationAllowed } from '@gajae-code/coding-agent/skill-state/workflow-mutation-guard';
import { prompt } from '@gajae-code/utils';
import * as z from 'zod/v4';

import type { GjcPermissionProvider } from './gjc-bun-permission-gate.js';

type Session = Awaited<ReturnType<typeof createAgentSession>>['session'];
type ToolUIContext = Parameters<Awaited<ReturnType<typeof createAgentSession>>['setToolUIContext']>[0];
const RECEIPT = 'gajae-app.delegation.v1';
const idSchema = z.string().uuid();
const repositoryBindingSchema = taskItemSchema.shape.repositoryBinding.unwrap();
// Strict providers require every object property, including optional binding
// metadata. Accept null for unused metadata, then normalize to the SDK contract.
const repositoryBindingInputSchema = repositoryBindingSchema.extend({
  relativeSubdir: repositoryBindingSchema.shape.relativeSubdir.nullish(),
  displayPath: repositoryBindingSchema.shape.displayPath.nullish(),
  head: repositoryBindingSchema.shape.head.nullish(),
  branch: repositoryBindingSchema.shape.branch.nullish(),
});
const taskSchema = z.strictObject({
  agent: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  context: z.string().max(100_000).nullish(),
  tasks: z.array(z.strictObject({
    id: z.string().min(1).max(100),
    description: z.string().min(1).max(1000),
    assignment: z.string().min(1).max(100_000),
    executionMode: z.enum(['default', 'ultragoal-red-team']).nullish().default('default')
      .describe('Use default for Planner, Architect, Critic, and ordinary Executor work. ultragoal-red-team is only for an explicitly assigned Executor QA/red-team lane.'),
    repositoryBinding: repositoryBindingInputSchema.nullish()
      .describe('Copy the workflow repository binding, or use null to bind to the current workspace. This does not change the child working directory.'),
  })).min(1).max(4),
});
const controlSchema = z.strictObject({
  action: z.enum(['list', 'inspect', 'await', 'cancel', 'resume']),
  id: idSchema.nullish(),
  ids: z.array(idSchema).max(32).nullish(),
  message: z.string().min(1).max(100_000).nullish(),
  timeout_ms: z.number().int().min(0).max(60_000).nullish(),
  condition: z.enum(['all_terminal', 'any_terminal']).nullish(),
});
const receiptSchema = z.object({
  id: idSchema,
  owner: idSchema,
  root: idSchema,
  childSessionId: idSchema,
  file: z.string().min(1),
  agent: taskSchema.shape.agent,
  executionMode: z.enum(['default', 'ultragoal-red-team']).optional(),
  repositoryBinding: taskItemSchema.shape.repositoryBinding,
  description: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  resultText: z.string().max(16_000),
});
type Receipt = z.infer<typeof receiptSchema>;
type Owner = { id: string; manager: SessionManager; depth: number; session: () => Session };
type Job = {
  receipt: Receipt;
  owner: Owner;
  controller: AbortController;
  session?: Session;
  done: Promise<void>;
  settled: boolean;
};

export const GJC_APP_DELEGATION_TOOL_NAMES = ['task', 'subagent'] as const;
export const GJC_DELEGATION_LIMITS = Object.freeze({ concurrency: 4, depth: 2, launches: 32, runtimeMs: 300_000 });

export type GjcDelegationOptions = {
  parent: SessionManager;
  session: () => Session;
  /** The actual parent options, including its app-owned tool overrides. */
  sessionOptions: CreateAgentSessionOptions;
  permissionProvider?: GjcPermissionProvider;
  createSession?: typeof createAgentSession;
};

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: value };
}

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('App delegation cancelled.');
}

function normalizeRepositoryBinding(binding: z.infer<typeof repositoryBindingInputSchema> | null | undefined) {
  if (!binding) return undefined;
  return {
    ...binding,
    relativeSubdir: binding.relativeSubdir ?? undefined,
    displayPath: binding.displayPath ?? undefined,
    head: binding.head ?? undefined,
    branch: binding.branch ?? undefined,
  };
}

/** A shared lock, also used by the parent, for the single app automation session. */
export function serializeGjcDelegationAutomationTools(tools: AutomationTools): AutomationTools {
  let tail = Promise.resolve();
  const serialized: AutomationTools = {};
  for (const name of ['browser', 'computer'] as const) {
    const tool = tools[name];
    if (!tool) continue;
    serialized[name] = {
      ...tool,
      async execute(...args: Parameters<typeof tool.execute>) {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((done) => { release = done; });
        try {
          await previous;
          checkSignal(args[2]);
          return await tool.execute(...args);
        } finally { release(); }
      },
    };
  }
  return serialized;
}

/**
 * App-owned children. No SDK task executor, async-job registry or discovery.
 * Receipts live in the calling transcript, so a resumed parent can only open
 * children it actually created. Each resume rebuilds policy from this run.
 */
export class GjcDelegationExecutor {
  readonly #jobs = new Map<string, Job>();
  readonly #root: Owner;
  readonly #closed = new AbortController();
  #launches = 0;
  #disposeTask?: Promise<void>;
  #cleanupFailed = false;

  constructor(readonly options: GjcDelegationOptions) {
    idSchema.parse(options.parent.getSessionId());
    this.#root = { id: options.parent.getSessionId(), manager: options.parent, depth: 0, session: options.session };
  }

  tools(owner: Owner = this.#root): CustomTool[] {
    const requested = new Set(this.options.sessionOptions.toolNames);
    const tools: CustomTool[] = [];
    if (requested.has('task')) tools.push({
      name: 'task', label: 'Task', concurrency: 'exclusive', parameters: taskSchema,
      description: 'Start app-owned delegated tasks. Children use this session’s exact model, effort, credentials, tool policy and app browser. Supply complete assignments/context. Returns child ids; use subagent await to collect results. At most 4 active children across the tree, 2 levels, 32 launches per turn, 5 minutes per child. Children are cancelled when their owner turn ends. No model overrides, worktree creation, detached work beyond the turn, or implicit context fork.',
      execute: async (callId, raw, _update, _context, signal) => {
        const params = taskSchema.parse(raw);
        this.#checkOwner(owner, signal);
        this.#checkRole(params.agent);
        if (params.agent !== 'executor' && params.tasks.some((task) => task.executionMode === 'ultragoal-red-team')) {
          throw new Error('Red-team execution mode requires the executor role.');
        }
        this.#checkCapacity(owner, params.tasks.length);
        const bindings = await Promise.all(params.tasks.map((task) =>
          resolveTaskRepositoryBinding(owner.manager.getCwd(), normalizeRepositoryBinding(task.repositoryBinding))));
        this.#checkOwner(owner, signal);
        await this.#authorize(owner, callId, params, signal);
        this.#checkOwner(owner, signal);
        this.#checkCapacity(owner, params.tasks.length);
        const jobs = params.tasks.map((task, index) => this.#launch(owner, params.agent, task.description,
          [params.context, task.assignment].filter(Boolean).join('\n\n'), undefined, task.executionMode ?? 'default', bindings[index]));
        return result({ subagents: jobs.map((job) => this.#snapshot(job.receipt)) });
      },
    });
    if (requested.has('subagent')) tools.push({
      name: 'subagent', label: 'Subagent', concurrency: 'exclusive', parameters: controlSchema,
      description: 'List, inspect, await, cancel or resume only this session’s own app-delegated children. Resume requires a message and reuses the saved child transcript with the current parent policy/model/effort/credential. Await returns bounded result text, not an agent:// artifact. No pause, steer, arbitrary session IDs or external jobs.',
      execute: async (callId, raw, _update, _context, signal) => {
        const params = controlSchema.parse(raw);
        this.#checkOwner(owner, signal);
        const receipts = this.#receipts(owner);
        const ids = params.id ? [params.id] : params.ids;
        if (params.id && params.ids) throw new Error('Specify id or ids, not both.');
        const selected = ids ? [...new Set(ids)].map((id) => {
          const receipt = receipts.get(id);
          if (!receipt) throw new Error('Subagent is not owned by this session.');
          return receipt;
        }) : [...receipts.values()].slice(-32);
        if (params.action === 'resume') {
          if (selected.length !== 1 || !ids || !params.message) throw new Error('Resume requires one child id and a message.');
          const receipt = selected[0]!;
          this.#checkRole(receipt.agent);
          if (this.#jobs.has(receipt.id) && !this.#jobs.get(receipt.id)!.settled) {
            throw new Error('Subagent is already running.');
          }
          this.#checkCapacity(owner, 1);
          await this.#authorize(owner, callId, { id: receipt.id, message: params.message }, signal);
          this.#checkOwner(owner, signal);
          this.#checkCapacity(owner, 1);
          if (this.#jobs.has(receipt.id) && !this.#jobs.get(receipt.id)!.settled) throw new Error('Subagent is already running.');
          const job = this.#launch(owner, receipt.agent, receipt.description, params.message, receipt);
          return result({ subagents: [this.#snapshot(job.receipt)] });
        }
        if (params.action === 'cancel') {
          await Promise.all(selected.map((receipt) => this.#cancel(receipt.id)));
        } else if (params.action === 'await') {
          const running = selected.map((receipt) => this.#jobs.get(receipt.id))
            .filter((job): job is Job => job !== undefined && !job.settled);
          if (running.length && !(params.condition === 'any_terminal'
            && selected.some((r) => !this.#jobs.has(r.id) || this.#jobs.get(r.id)!.settled))) {
            await this.#wait(running, params.timeout_ms ?? 30_000, params.condition === 'any_terminal', signal);
          }
        }
        const refreshed = this.#receipts(owner);
        return result({ subagents: selected.map((receipt) => this.#snapshot(refreshed.get(receipt.id)!)) });
      },
    });
    return tools;
  }

  #checkOwner(owner: Owner, signal?: AbortSignal): void {
    checkSignal(signal);
    checkSignal(this.#closed.signal);
    for (const job of this.#jobs.values()) {
      if (job.receipt.childSessionId === owner.manager.getSessionId()) checkSignal(job.controller.signal);
    }
    if (owner.id !== owner.manager.getSessionId() || owner.id !== owner.session().sessionManager.getSessionId()) {
      throw new Error('Delegation owner changed.');
    }
  }

  #checkRole(role: string): void {
    const spawns = this.options.sessionOptions.spawns ?? 'deny';
    if (spawns !== '*' && !spawns.split(',').map((value) => value.trim()).filter((value) => value !== 'deny').includes(role)) {
      throw new Error('Delegation role is not allowed by this session.');
    }
    if (!getBundledAgent(role)) throw new Error('Unknown bundled delegation role.');
  }

  #checkCapacity(owner: Owner, count: number): void {
    if (owner.depth >= GJC_DELEGATION_LIMITS.depth) throw new Error('App delegation depth limit reached.');
    if ([...this.#jobs.values()].filter((job) => !job.settled).length + count > GJC_DELEGATION_LIMITS.concurrency) {
      throw new Error('App delegation concurrency limit reached; await existing children first.');
    }
    if (this.#launches + count > GJC_DELEGATION_LIMITS.launches) throw new Error('App delegation turn launch limit reached.');
  }

  async #authorize(owner: Owner, toolCallId: string, rawInput: unknown, signal?: AbortSignal): Promise<void> {
    const mode = owner.session().sdkPermissionMode;
    if (mode === 'allow') return;
    if (mode !== 'prompt' || !this.options.permissionProvider) throw new Error('Delegation rejected by session permission policy.');
    const outcome = await this.options.permissionProvider({
      toolCallId: `delegation:${owner.manager.getSessionId()}:${toolCallId}`,
      toolName: 'task', title: 'Run delegated work using the selected model and credentials?',
      status: 'pending', rawInput,
    }, [
      { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' },
    ], signal);
    checkSignal(signal);
    if (outcome.outcome !== 'selected' || !['allow_once', 'allow_always'].includes(outcome.optionId)) {
      throw new Error('Delegation rejected by session permission policy.');
    }
  }

  #receipts(owner: Owner): Map<string, Receipt> {
    const receipts = new Map<string, Receipt>();
    for (const entry of owner.manager.getEntries()) {
      if (entry.type !== 'custom' || entry.customType !== RECEIPT) continue;
      const parsed = receiptSchema.safeParse(entry.data);
      if (!parsed.success || parsed.data.owner !== owner.manager.getSessionId()
        || parsed.data.root !== this.#root.id) continue;
      const receipt = parsed.data;
      // A process restart or owner-turn disposal never resurrects background work.
      if (receipt.status === 'running' && !this.#jobs.has(receipt.id)) receipt.status = 'cancelled';
      receipts.set(receipt.id, receipt);
    }
    for (const job of this.#jobs.values()) {
      if (job.receipt.owner === owner.manager.getSessionId()) receipts.set(job.receipt.id, job.receipt);
    }
    return receipts;
  }

  #snapshot(receipt: Receipt) {
    const { file: _file, owner: _owner, root: _root, childSessionId: _session, ...publicReceipt } = receipt;
    const job = this.#jobs.get(receipt.id);
    return { ...publicReceipt, status: job && !job.settled ? 'running' : receipt.status };
  }

  #launch(owner: Owner, agent: string, description: string, message: string, previous?: Receipt, executionMode?: Receipt['executionMode'], repositoryBinding?: Receipt['repositoryBinding']): Job {
    this.#launches += 1;
    const id = previous?.id ?? randomUUID();
    const receipt: Receipt = { ...previous, id, owner: owner.id, root: this.#root.id,
      agent, description, childSessionId: previous?.childSessionId ?? randomUUID(), file: previous?.file ?? '',
      executionMode: previous?.executionMode ?? executionMode,
      repositoryBinding: previous?.repositoryBinding ?? repositoryBinding,
      status: 'running', resultText: '' };
    const job: Job = { receipt, owner, controller: new AbortController(), done: Promise.resolve(), settled: false };
    this.#jobs.set(id, job);
    // Reserve capacity before any asynchronous setup or permission callback can race.
    job.done = this.#run(job, message, previous !== undefined).catch(() => {
      this.#cleanupFailed = true;
      job.receipt.status = 'failed';
      job.receipt.resultText = 'Delegated session cleanup failed.';
    }).finally(() => { job.settled = true; });
    return job;
  }

  async #run(job: Job, message: string, resume: boolean): Promise<void> {
    let unsubscribe: (() => void) | undefined;
    const timeout = setTimeout(() => job.controller.abort(), GJC_DELEGATION_LIMITS.runtimeMs);
    try {
      this.#checkOwner(job.owner, job.controller.signal);
      const parent = job.owner.session();
      const model = parent.model;
      const thinkingLevel = parent.thinkingLevel;
      const permissionMode = parent.sdkPermissionMode;
      const base = this.options.sessionOptions;
      job.receipt.repositoryBinding = await resolveTaskRepositoryBinding(parent.sessionManager.getCwd(), job.receipt.repositoryBinding);
      if (!model || thinkingLevel === undefined) throw new Error('Delegation requires an exact model and effort.');
      const selector = base.authStorage?.resolveEffectiveCredentialSelector(model.provider, parent.credentialSessionId)
        ?? base.credentialSelector?.selector;
      const settings = await parent.settings.cloneForCwd(parent.sessionManager.getCwd());
      // Delegated work never starts independent goal loops or background model roles.
      settings.override('goal.enabled', false);
      settings.override('memory.enabled', false);
      settings.override('compaction.enabled', false);
      settings.override('tools.discoveryMode', 'off');
      settings.override('mcp.discoveryMode', false);
      settings.override('mcp.enableProjectConfig', false);
      settings.override('astEdit.enabled', false);
      settings.override('task.eager', false);
      settings.setModelRole('default', `${model.provider}/${model.id}`);
      const directory = join(this.options.parent.getSessionDir(), '.app-delegation', job.receipt.root, job.receipt.owner);
      let manager: SessionManager;
      if (resume) {
        const file = resolve(directory, job.receipt.file);
        if (basename(job.receipt.file) !== job.receipt.file || dirname(file) !== resolve(directory)) throw new Error('Invalid child transcript.');
        const canonicalRoot = await realpath(this.options.parent.getSessionDir());
        const canonicalFile = await realpath(file);
        const contained = relative(canonicalRoot, canonicalFile);
        if (contained.startsWith(`..${sep}`) || contained === '..' || resolve(canonicalFile) !== file) throw new Error('Invalid child transcript.');
        manager = await SessionManager.open(file, directory);
        if (manager.getSessionId() !== job.receipt.childSessionId || manager.getCwd() !== parent.sessionManager.getCwd()) {
          throw new Error('Child transcript identity mismatch.');
        }
      } else {
        manager = SessionManager.create(parent.sessionManager.getCwd(), directory);
        job.receipt.childSessionId = manager.getSessionId();
        job.receipt.file = basename(manager.getSessionFile()!);
      }
      job.owner.manager.appendCustomEntry(RECEIPT, { ...job.receipt });
      await job.owner.manager.flush();
      checkSignal(job.controller.signal);
      checkSignal(this.#closed.signal);
      const role = getBundledAgent(job.receipt.agent)!;
      const requested = new Set(base.toolNames);
      const inherited: string[] = parent.getActiveToolNames().filter((name: string) => requested.has(name));
      // Role tools can narrow the parent policy, never widen it. The SDK's exec
      // pseudo-tool is deliberately not expanded into unrequested capabilities.
      const allowed = inherited.filter((name) => name !== 'goal'
        && (name !== 'browser' && name !== 'computer' || base.automationTools?.[name] !== undefined)
        && (!role.tools || role.tools.includes(name) || name === 'task' || name === 'subagent' || name === 'ask'));
      // Public extension hooks guard later subskill activation as well as the
      // initial selection. A tool added after bootstrap cannot widen policy.
      const enforceAllowlist: ExtensionFactory = (api) => {
        api.on('tool_call', async (event) => {
          checkSignal(job.controller.signal);
          if (!allowed.includes(event.toolName)) return { block: true, reason: 'Tool is outside the parent delegation allowlist.' };
          const tool = job.session?.getToolByName(event.toolName);
          if (!tool) return { block: true, reason: 'Delegated tool is unavailable.' };
          // Child logical IDs are deliberately distinct. The SDK's default
          // guard therefore sees the child's workflow state, not its owner's.
          // Apply the native guard to both direct-owner and root state without
          // copying or inventing workflow receipts in the child's directory.
          for (const owner of new Set([job.owner, this.#root])) {
            this.#checkOwner(owner, job.controller.signal);
            await assertWorkflowMutationAllowed({
              cwd: owner.manager.getCwd(), sessionId: owner.id, tool, args: event.input,
            });
            if (event.toolName === 'ask') {
              const diagnostic = await isUltragoalAskBlocked(owner.manager.getCwd(), { sessionId: owner.id });
              if (diagnostic.active) {
                const nudge = await consumeUltragoalAskNudge(owner.manager.getCwd(), owner.id, owner.session().settings.getAgentDir());
                return { block: true, reason: nudge.nudged ? nudge.message : formatUltragoalAskBlockMessage(diagnostic) };
              }
            }
          }
        });
      };
      const childOwner: Owner = { id: manager.getSessionId(), manager, depth: job.owner.depth + 1, session: () => job.session! };
      const customTools = [
        ...(base.customTools ?? []).filter((tool) => allowed.includes(tool.name)
          && !GJC_APP_DELEGATION_TOOL_NAMES.includes(tool.name as 'task' | 'subagent')),
        ...this.tools(childOwner).filter((tool) => allowed.includes(tool.name)),
      ];
      const output = await (this.options.createSession ?? createAgentSession)({
        ...base, cwd: parent.sessionManager.getCwd(), sessionManager: manager, settings,
        agentDir: base.agentDir ?? parent.settings.getAgentDir(),
        agentId: job.receipt.id, agentDisplayName: job.receipt.agent,
        model, thinkingLevel, modelPattern: undefined, activeModelProfile: undefined,
        providerSessionId: undefined, credentialSessionId: undefined,
        credentialSelector: selector ? { provider: model.provider, selector, raw: `${selector.kind}:${selector.value}` } : undefined,
        preferredCredentialSelector: undefined, startupAuthConfig: undefined,
        toolNames: allowed.filter((name) => !GJC_APP_DELEGATION_TOOL_NAMES.includes(name as 'task' | 'subagent')),
        customTools, spawns: 'deny', taskDepth: childOwner.depth, currentAgentType: job.receipt.agent,
        enableMcpAutoload: false, disableExtensionDiscovery: true,
        extensions: [enforceAllowlist], additionalExtensionPaths: [], hookPaths: [], preloadedExtensions: undefined,
        discoverableToolAllowedNames: [], requireYieldTool: false, outputSchema: undefined,
        goalToolAllowedOps: [], masterModeContext: undefined,
        forkContextSeed: undefined, providerSessionState: undefined,
        systemPrompt: (defaults) => [...(typeof base.systemPrompt === 'function' ? base.systemPrompt(defaults) : base.systemPrompt ?? defaults),
          `You are a delegated ${job.receipt.agent}. Your owner supplied the assignment below. Stay within its scope. Return findings and evidence.`,
          `App delegation id: ${job.receipt.id}. Direct owner session_id: ${job.receipt.owner}. Root session_id: ${job.receipt.root}. Repository binding: ${JSON.stringify(job.receipt.repositoryBinding)}. For workflow writes use the assignment's explicit owner session_id and run_id; do not substitute your child session id.`,
          prompt.render(role.systemPrompt, { ultragoalRedTeam: job.receipt.executionMode === 'ultragoal-red-team' }),
          'Use only the supplied tools. Return final text directly; yield and IRC are unavailable. Goal lifecycle remains owned by the root app session.'],
      });
      job.session = output.session;
      this.#checkOwner(job.owner, job.controller.signal);
      checkSignal(job.controller.signal);
      checkSignal(this.#closed.signal);
      if (output.modelFallbackMessage) throw new Error('Child model fallback refused.');
      await output.session.setModelTemporary(model, thinkingLevel, { persistAsSessionDefault: true, cause: 'startup-override' });
      output.session.setConfiguredModelChain('default', [`${model.provider}/${model.id}`], 'startup-override', undefined, true);
      output.session.seedDefaultFallbackResolution(0, []);
      output.session.setSdkPermissionMode(permissionMode);
      output.session.setSdkPermissionProvider(this.options.permissionProvider);
      await output.session.setActiveToolsByName(allowed);
      if (output.session.getActiveToolNames().some((name: string) => !allowed.includes(name))) throw new Error('Child tool allowlist mismatch.');
      if (output.session.model?.id !== model.id || output.session.model?.provider !== model.provider
        || output.session.thinkingLevel !== thinkingLevel) throw new Error('Child model or effort mismatch.');
      // The same UI bridge owns child questions and app automation approvals.
      if (this.#ui) output.setToolUIContext(this.#ui, true);
      unsubscribe = output.session.subscribe((event: AgentSessionEvent) => {
        if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
        job.receipt.resultText = event.message.content.filter((block: { type: string; text?: string }) => block.type === 'text')
          .map((block: { text?: string }) => block.text).join('\n').slice(-16_000);
        if (event.message.stopReason === 'error') job.receipt.status = 'failed';
      });
      const abort = () => { void output.session.abort().catch(() => {}); };
      job.controller.signal.addEventListener('abort', abort, { once: true });
      try {
        checkSignal(job.controller.signal);
        await output.session.prompt(message);
      } finally { job.controller.signal.removeEventListener('abort', abort); }
      if (job.receipt.status === 'running') job.receipt.status = 'completed';
    } catch {
      job.receipt.status = 'failed';
      // SDK exceptions can contain provider payloads or credentials; keep them off receipts.
      job.receipt.resultText = 'Delegated work failed. No successful result is available.';
    } finally {
      clearTimeout(timeout);
      unsubscribe?.();
      if (job.session) {
        await this.#cancelOwned(job.receipt.childSessionId);
        try { await job.session.dispose(); }
        catch { this.#cleanupFailed = true; job.receipt.status = 'failed'; job.receipt.resultText = 'Delegated session cleanup failed.'; }
      }
      if (job.controller.signal.aborted || this.#closed.signal.aborted) job.receipt.status = 'cancelled';
      job.owner.manager.appendCustomEntry(RECEIPT, { ...job.receipt });
      await job.owner.manager.flush();
    }
  }

  #ui?: ToolUIContext;

  setToolUIContext(ui: ToolUIContext): void {
    this.#ui = ui;
  }

  async #wait(jobs: Job[], timeoutMs: number, any: boolean, signal?: AbortSignal): Promise<void> {
    checkSignal(signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    try {
      await Promise.race([
        any ? Promise.race(jobs.map((job) => job.done)) : Promise.all(jobs.map((job) => job.done)),
        new Promise<void>((done) => { timer = setTimeout(done, timeoutMs); }),
        new Promise<never>((_done, reject) => {
          abort = () => reject(new Error('App delegation wait cancelled.'));
          signal?.addEventListener('abort', abort, { once: true });
        }),
      ]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  async #cancel(id: string): Promise<void> {
    const job = this.#jobs.get(id);
    if (!job || job.settled) return;
    job.controller.abort();
    await this.#cancelOwned(job.receipt.childSessionId);
    await job.done;
  }

  async #cancelOwned(owner: string): Promise<void> {
    await Promise.all([...this.#jobs.values()].filter((job) => job.receipt.owner === owner).map((job) => this.#cancel(job.receipt.id)));
  }

  dispose(): Promise<void> {
    if (!this.#disposeTask) {
      this.#closed.abort();
      for (const job of this.#jobs.values()) job.controller.abort();
      this.#disposeTask = Promise.all([...this.#jobs.values()].map((job) => job.done)).then(() => {
        if (this.#cleanupFailed) throw new Error('App delegation cleanup failed.');
      });
    }
    return this.#disposeTask;
  }
}
