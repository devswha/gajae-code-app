import { createAgentSession, discoverAuthStorage } from '@gajae-code/coding-agent/sdk/session';
import { ModelRegistry } from '@gajae-code/coding-agent/config/model-registry';
import { mergeModelProfiles, resolveProfileBindings } from '@gajae-code/coding-agent/config/model-profiles';
import { activateModelProfile } from '@gajae-code/coding-agent/config/model-profile-activation';
import { resolveModelRoleValue } from '@gajae-code/coding-agent/config/model-resolver';
import { Settings } from '@gajae-code/coding-agent/config/settings';
import { AuthStorage } from '@gajae-code/coding-agent/session/auth-storage';
import { SessionManager } from '@gajae-code/coding-agent/session/session-manager';
import { executeAcpBuiltinSlashCommand } from '@gajae-code/coding-agent/slash-commands/acp-builtins';
import { initTheme, theme } from '@gajae-code/coding-agent/modes/theme/theme';
import { generateSessionTitle } from '@gajae-code/coding-agent/utils/title-generator';
import { getSupportedEfforts } from '@gajae-code/ai/model-thinking';

import { appendImagesInputTag } from './shared/image-attachments.js';
import { GjcBunOAuthController, type GjcBunOAuthControllerOptions } from './gjc-bun-oauth-controller.js';
import { GJC_APP_BUILTIN_COMMAND_NAMES } from './gjc-command-surface.generated.js';
import type { GjcWorkerOAuthRuntime, GjcWorkerRuntime, GjcWorkerWriter } from './gjc-worker.js';
import { GjcBunAskController } from './gjc-bun-ask-controller.js';
import { createGjcPermissionProvider, type GjcPermissionProvider } from './gjc-bun-permission-gate.js';
import { forwardPromptTerminal, forwardSdkEvent, normalizeBuiltinCommandStdout, type SdkRunState } from './gjc-bun-sdk-events.js';
import { parseGjcRunPermissions, type GjcRunPermissions } from './gjc-permission-policy.js';
import { GjcModelResolutionError } from './gjc-model-resolution.js';
import { resolveContainedExportCommand } from './gjc-export-path.js';
import { readSessionSnapshot } from './gjc-session-state.js';
import { installGjcCliShim } from './gjc-cli-shim.js';
import {
  closeGjcAutomationSession,
  createGjcAutomationTools,
  takeGjcAutomationBridgeTransport,
  type GjcAutomationBridgeTransport,
} from './gjc-automation-tools.js';
type Model = ReturnType<ModelRegistry['getAll']>[number];

type ExactCredentialRef =
  | { kind: 'stored'; providerId?: string; credentialId?: number }
  | { kind: 'runtime-env'; envVar: string };
type AppBashPolicy = { allowedPrefixes: string[]; restrictionProfile?: 'workflow' | 'read-only' };
export type SdkRunConfig = {
  cwd: string;
  sessionRoot: string;
  credential: ExactCredentialRef;
  modelId: string;
  modelProfile?: string;
  effort?: 'default' | 'inherit' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  toolNames: string[];
  spawns: string;
  bashPolicy: AppBashPolicy;
  appSessionId?: string;
  /** Image attachments the client sent with this message (`{path, name?, mimeType?}` descriptors). */
  images?: unknown;
  /**
   * The project's permission policy. Absent means the app did not decide, and
   * the runtime keeps its own default (guarded tools run unprompted); present
   * means the session is switched to `prompt` mode and this policy answers.
   */
  permissions?: GjcRunPermissions;
};

/**
 * Appended to every session's system prompt: facts about the environment the
 * model runs in that its training cannot know.
 */
const GAJAE_APP_ENV_NOTE = [
  'This session runs inside Gajae Code App, which hosts the Gajae Code runtime in-process.',
  "The bundled gjc shim on PATH is for bundled workflow skills' `gjc state <skill> ...` commands; for sign-in, models, and permissions, use the app's Settings and never edit ~/.gjc directly.",
].join(' ');

let warnedAboutGjcCliShim = false;

export type GjcAgentSessionFactory = typeof createAgentSession;
/** The runtime's title generator, narrowed to what the adapter supplies. */
export type GjcSessionTitleGenerator = (firstMessage: string, registry: ModelRegistry, settings: Settings, model: Model) => Promise<string | null>;
export type GjcBunSdkAdapterOptions = {
  createSessionFactory?: GjcAgentSessionFactory;
  generateSessionTitle?: GjcSessionTitleGenerator;
  settings?: Settings;
  loadSettings?: () => Promise<Settings>;
  executeBuiltinCommand?: typeof executeAcpBuiltinSlashCommand;
  oauth?: GjcBunOAuthControllerOptions;
  automationBridge?: GjcAutomationBridgeTransport;
  closeAutomationSession?: (appSessionId: string) => Promise<void>;
};

type ActiveRun = {
  session: {
    prompt(message: string, options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void>;
    abort(): Promise<void>;
    dispose(): Promise<void>;
    subscribe(listener: (event: unknown) => void): () => void;
    /** True while a turn is in flight. Absent on runtimes that never stream. */
    readonly isStreaming?: boolean;
    setSdkPermissionMode?(mode: 'prompt' | 'allow' | 'deny'): void;
    setSdkPermissionProvider?(provider: GjcPermissionProvider | undefined): void;
  };
  sessionManager: SessionManager;
  unsubscribe: () => void;
  askController: GjcBunAskController;
  state: SdkRunState;
  abortState: 'idle' | 'aborting' | 'aborted';
  appSessionId?: string;
};

const FAILURE = 'GJC SDK configuration is invalid.';
const MODEL_ID_EFFORT = /-(off|minimal|low|medium|high|xhigh|max)(?:-fast)?$/;
/**
 * How long a finished turn waits for its title before giving up on it. The
 * title is a 30-token completion started with the turn, so it is normally
 * long done; a hung title request must not hold the turn's terminal frame.
 */
const SESSION_TITLE_GRACE_MS = 10_000;
/** The runtime's own opt-out, honoured so one environment silences both the TUI and the app. */
function sessionTitlesDisabled(): boolean {
  return Boolean(process.env.GJC_NO_TITLE || process.env.PI_NO_TITLE);
}
/**
 * The runtime picks the title model itself (its `default` role, else the
 * turn's model). No sticky-credential session id or metadata resolver is
 * passed: the app selects credentials per run, not per TUI session.
 */
const runtimeSessionTitle: GjcSessionTitleGenerator = (firstMessage, registry, settings, model) =>
  generateSessionTitle(firstMessage, registry, settings, undefined, model);
const RUNTIME_CREDENTIAL_ENV_VARS = new Set([
  'GJC_RUNTIME_API_KEY',
]);

export function applyGjcToolSettingsPolicy(settings: Settings): void {
  // Goal mode writes artifacts the app cannot display, then injects hidden
  // continuation turns until completion. The app projects no goal state, so
  // users have no badge, pause, or cancel control for that self-restarting loop.
  settings.override('goal.enabled', false);

  // ast_edit only previews rewrites and queues hidden `resolve` to apply them.
  // `resolve` is not requestable through toolNames, so leaving this enabled
  // would advertise edits the browser session can never commit.
  settings.override('astEdit.enabled', false);

  // Tool discovery is the other door into the session's tool set, and it does
  // not consult `toolNames`: a server listed in the user's own settings, or an
  // `.mcp.json` in whatever project they open, would put tools this app never
  // decided on in front of a browser session. Both default to false, so this
  // pins the default rather than changing behaviour - but a boundary that only
  // holds while a user leaves their config alone is not a boundary.
  settings.override('mcp.discoveryMode', false);
  settings.override('mcp.enableProjectConfig', false);
}

function isAppOAuthCommand(message: string): boolean {
  const commandName = /^\/([^\s]+)/.exec(message.trim())?.[1];
  return commandName === 'login' || commandName === 'logout';
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactCredentialRef(value: unknown): value is ExactCredentialRef {
  if (!object(value)) return false;
  if (value.kind === 'stored') {
    return Object.keys(value).every((key) => key === 'kind' || key === 'providerId' || key === 'credentialId')
      && (value.providerId === undefined || (typeof value.providerId === 'string' && value.providerId.length > 0))
      && (value.credentialId === undefined || (typeof value.credentialId === 'number' && Number.isInteger(value.credentialId)));
  }
  return value.kind === 'runtime-env'
    && Object.keys(value).length === 2
    && typeof value.envVar === 'string'
    && RUNTIME_CREDENTIAL_ENV_VARS.has(value.envVar);
}

function configFromOptions(value: Record<string, unknown>): SdkRunConfig {
  const candidate = value;
  if (!object(candidate)
    || typeof candidate.cwd !== 'string' || !candidate.cwd
    || typeof candidate.sessionRoot !== 'string' || !candidate.sessionRoot
    || !exactCredentialRef(candidate.credential)
    || typeof candidate.modelId !== 'string' || !candidate.modelId
    || (candidate.modelProfile !== undefined && (typeof candidate.modelProfile !== 'string' || !candidate.modelProfile))
    || (candidate.effort !== undefined && ![
      'default', 'inherit', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
    ].includes(String(candidate.effort)))
    || !Array.isArray(candidate.toolNames) || candidate.toolNames.some((name) => typeof name !== 'string' || !name)
    || typeof candidate.spawns !== 'string'
    || !object(candidate.bashPolicy) || !Array.isArray(candidate.bashPolicy.allowedPrefixes)
    || candidate.bashPolicy.allowedPrefixes.some((prefix) => typeof prefix !== 'string')
    || (candidate.bashPolicy.restrictionProfile !== undefined
      && candidate.bashPolicy.restrictionProfile !== 'workflow'
      && candidate.bashPolicy.restrictionProfile !== 'read-only')
    || (candidate.appSessionId !== undefined && (typeof candidate.appSessionId !== 'string' || !candidate.appSessionId))
  ) throw new Error(FAILURE);
  // A malformed policy block throws GjcRunPermissionsError, which keeps its
  // `invalid_permissions` code so the worker can answer with that code and the
  // app can tell the user why the run never started.
  const permissions = parseGjcRunPermissions(candidate.permissions);
  return { ...(candidate as unknown as SdkRunConfig), ...(permissions ? { permissions } : {}) };
}

async function modelsForCredential(
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
  credential: ExactCredentialRef,
): Promise<Model[]> {
  const available = modelRegistry.getAvailable();
  if (credential.kind === 'runtime-env') return available;

  const rows: Array<{ id: number; provider: string }> = authStorage.exportSnapshot().credentials;
  const eligibleProviders = new Set(
    rows
      .filter((row) => credential.providerId === undefined || row.provider === credential.providerId)
      .filter((row) => credential.credentialId === undefined || row.id === credential.credentialId)
      .map((row) => row.provider),
  );
  // A provider with no stored row can still be usable when the auth layer can
  // resolve a credential another way - a `models.yml` `apiKey`/`apiKeyEnv` pin,
  // or the env fallback. `peekApiKey` answers exactly that question without
  // resolving anything, so probing each row-less provider once keeps default
  // role resolution aligned with what the run could actually authenticate. A
  // pinned providerId/credentialId is an assertion, not a search: no probe.
  if (credential.providerId === undefined && credential.credentialId === undefined) {
    for (const provider of new Set(available.map((model) => model.provider))) {
      if (!eligibleProviders.has(provider) && await authStorage.peekApiKey(provider) !== undefined) {
        eligibleProviders.add(provider);
      }
    }
  }
  return available.filter((model) => eligibleProviders.has(model.provider));
}

async function configuredDefaultModelId(
  settings: Settings,
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
  credential: ExactCredentialRef,
  modelProfile?: string,
): Promise<string> {
  const resolveConfigured = async (selector: Parameters<typeof resolveModelRoleValue>[0]): Promise<string | undefined> => {
    const resolved = resolveModelRoleValue(selector, await modelsForCredential(authStorage, modelRegistry, credential), {
      settings,
      modelRegistry,
    });
    return resolved.model ? `${resolved.model.provider}/${resolved.model.id}` : undefined;
  };
  if (modelProfile) {
    const profile = modelRegistry.getModelProfile(modelProfile) ?? mergeModelProfiles().get(modelProfile);
    const selector = profile && resolveProfileBindings(profile).defaultSelector;
    const resolved = await resolveConfigured(selector);
    if (!resolved) throw new GjcModelResolutionError();
    return resolved;
  }
  const roleValue = settings.getModelRole('default');
  const roleModelId = await resolveConfigured(roleValue);
  if (roleModelId) return roleModelId;

  const profileName = settings.get('modelProfile.default');
  if (typeof profileName !== 'string' || !profileName) throw new GjcModelResolutionError();

  // ModelRegistry loads models.yml user profiles and merges them with builtins.
  const profile = modelRegistry.getModelProfile(profileName) ?? mergeModelProfiles().get(profileName);
  const selector = profile && resolveProfileBindings(profile).defaultSelector;
  const resolved = await resolveConfigured(selector);
  if (!resolved) throw new GjcModelResolutionError();
  return resolved;
}

/**
 * The `default` role resolves against the registry's available models, and a
 * warm worker's registry can lose models between runs: after a turn, the
 * runtime's catalog refresh replaces a preset-registered provider's models
 * with the one it discovered, and the role's model is no longer there until
 * the next `refresh()` restores it. Every `session.start` with the app default
 * after that failed with `model_unresolved` while an explicit model id, which
 * already refreshes on a miss, kept working. Same remedy here.
 */
async function configuredDefaultModelIdWithRefresh(
  settings: Settings,
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
  credential: ExactCredentialRef,
  modelProfile?: string,
): Promise<string> {
  try {
    return await configuredDefaultModelId(settings, authStorage, modelRegistry, credential, modelProfile);
  } catch (error) {
    if (!(error instanceof GjcModelResolutionError)) throw error;
    await modelRegistry.refresh();
    return configuredDefaultModelId(settings, authStorage, modelRegistry, credential, modelProfile);
  }
}

function modelFor(registry: ModelRegistry, modelId: string): Model {
  const all = registry.getAll();
  // Provider-qualified form wins: a gateway model whose bare id happens to look
  // like "provider/id" must not shadow the provider-qualified reference.
  const qualified = all.filter((model) => `${model.provider}/${model.id}` === modelId);
  const matches = qualified.length > 0 ? qualified : all.filter((model) => model.id === modelId);
  if (matches.length !== 1) throw new Error(FAILURE);
  return matches[0];
}

async function modelForWithRefresh(registry: ModelRegistry, modelId: string): Promise<Model> {
  try {
    return modelFor(registry, modelId);
  } catch {
    // A long-lived worker may not have seen newly available models yet.
    await registry.refresh();
    return modelFor(registry, modelId);
  }
}

async function credentialFor(
  authStorage: AuthStorage,
  credential: ExactCredentialRef,
  model: ReturnType<ModelRegistry['getAll']>[number],
): Promise<{ credentialSelector?: { provider: string; selector: { kind: 'id'; value: string }; raw: string }; credential?: { kind: 'stored'; providerId: string; credentialId: number }; dispose(): void }> {
  if (credential.kind === 'stored') {
    // The provider is derived deterministically from the pinned model; an
    // explicit providerId is an assertion that must agree with it.
    if (credential.providerId !== undefined && credential.providerId !== model.provider) throw new Error(FAILURE);
    const snapshotRows: Array<{ id: number; provider: string }> = authStorage.exportSnapshot().credentials;
    const rows = snapshotRows
      .filter((row) => row.provider === model.provider)
      .sort((left, right) => left.id - right.id);
    if (rows.length === 0) {
      // No stored row to pin. The runtime still authenticates the provider
      // itself when no selector is installed - a `models.yml` `apiKey`/
      // `apiKeyEnv` pin or the env fallback, which is how the CLI runs these
      // providers. When nothing resolves either, name the model problem
      // instead of failing as a generic worker error.
      if (await authStorage.peekApiKey(model.provider) === undefined) throw new GjcModelResolutionError();
      return { dispose() {} };
    }
    // Deterministic selection: explicit credentialId wins; otherwise the lowest
    // stored row id. Installing a selector also blocks the env-var fallback.
    const row = credential.credentialId !== undefined
      ? rows.find((candidate) => candidate.id === credential.credentialId)
      : rows[0];
    if (!row) throw new Error(FAILURE);
    return {
      credentialSelector: {
        provider: model.provider,
        selector: { kind: 'id', value: String(row.id) },
        raw: `id:${row.id}`,
      },
      credential: { kind: 'stored', providerId: model.provider, credentialId: row.id },
      dispose() {},
    };
  }

  const apiKey = process.env[credential.envVar];
  if (!apiKey) throw new Error(FAILURE);
  authStorage.setRuntimeApiKey(model.provider, apiKey);
  return {
    dispose: () => authStorage.removeRuntimeApiKey(model.provider),
  };
}

async function resumeManager(providerSessionId: string, sessionRoot: string): Promise<SessionManager> {
  const matches = (await SessionManager.list('', sessionRoot)).filter((session) => session.id === providerSessionId);
  if (matches.length !== 1) throw new Error(FAILURE);
  const manager = await SessionManager.open(matches[0].path, sessionRoot);
  if (manager.getSessionId() !== providerSessionId) throw new Error(FAILURE);
  return manager;
}

/** In-process, serial-only SDK runtime. AuthStorage and ModelRegistry are app-owned singleton inputs. */
export class GjcBunSdkAdapter implements GjcWorkerRuntime {
  readonly #runs = new Map<string, ActiveRun>();
  /** Runs accepted but not yet holding a session; an abort can still reach them. */
  readonly #starting = new Map<string, { abortRequested: boolean }>();
  readonly oauth: GjcWorkerOAuthRuntime;

  constructor(
    private readonly authStorage: AuthStorage,
    private readonly modelRegistry: ModelRegistry,
    private readonly options: GjcBunSdkAdapterOptions = {},
  ) {
    if (modelRegistry.authStorage !== authStorage) throw new Error(FAILURE);
    const oauth = new GjcBunOAuthController(authStorage, modelRegistry, options.oauth);
    this.oauth = {
      providers: () => oauth.providers(),
      status: () => oauth.status(),
      start: (providerId) => oauth.start(providerId),
      submit: (attemptId, value) => oauth.submit(attemptId, value),
      cancel: (attemptId) => oauth.cancel(attemptId),
      subscribe: (listener) => oauth.subscribe(listener),
      close: () => oauth.close(),
    };
  }

  async modelCatalog() {
    const seen = new Set<string>();
    const models = [];
    const candidates = await modelsForCredential(this.authStorage, this.modelRegistry, { kind: 'stored' });

    const selections = this.modelRegistry.getCanonicalModelSelections({
      availableOnly: true,
      candidates,
    });
    for (const { record, model } of selections) {
      if (!model) continue;
      const value = `${model.provider}/${model.id}`;
      if (seen.has(value)) continue;
      seen.add(value);
      let efforts: readonly string[] = [];
      if (model.reasoning) {
        efforts = getSupportedEfforts(model);
      }
      const defaultEffort = MODEL_ID_EFFORT.exec(model.id)?.[1];
      models.push({
        value,
        label: record.name || model.name || model.id,
        group: model.provider,
        canonicalId: record.id,
        effort: {
          ...(defaultEffort ? { default: defaultEffort } : {}),
          values: efforts.map((effort) => ({ value: effort })),
        },
      });
    }
    return { models };
  }

  spawnGjc(message: string, options: Record<string, unknown>, writer: GjcWorkerWriter): Promise<void> & { abortHandle?: string; processId?: number } {
    if (isAppOAuthCommand(message)) throw new Error(FAILURE);
    const runId = typeof options.runHandle === 'string' && options.runHandle ? options.runHandle : '';
    const config = configFromOptions(options);
    if (!runId || this.#runs.has(runId) || this.#starting.has(runId)) throw new Error(FAILURE);
    this.#starting.set(runId, { abortRequested: false });
    const task = this.#run(runId, message, options, config, writer).finally(() => this.#starting.delete(runId));
    return Object.assign(task, { abortHandle: runId });
  }

  /**
   * Delivers a message into the turn that is already running.
   *
   * The SDK's own `prompt()` routes a call made while streaming into the
   * session's steering queue, so the running turn picks the message up instead
   * of a second turn being started behind it. That is the whole feature: the
   * live session object is already held here for the duration of the run,
   * which is the same handle `abortGjcSession` uses.
   *
   * Refuses when the run is not streaming. Prompting a settled session would
   * silently start a fresh turn under a run id whose terminal event the client
   * has already seen, so the caller queues the message instead.
   */
  async steerGjcSession(runHandle: string, message: string): Promise<boolean> {
    const run = this.#runs.get(runHandle);
    if (!run || run.abortState !== 'idle') return false;
    if (run.session.isStreaming === false) return false;

    const text = message.trim();
    if (!text) return false;

    // The SDK refuses a bare prompt() on a busy agent (AgentBusyError) and
    // requires the caller to say which queue the message belongs in. 'steer' is
    // the one the running turn consumes at its next tool or turn boundary.
    await run.session.prompt(text, { streamingBehavior: 'steer' });
    return true;
  }

  async abortGjcSession(sessionId: string): Promise<boolean> {
    const run = this.#runs.get(sessionId);
    if (!run) {
      // Stop pressed while the session is still being built (model and
      // credential resolution, createAgentSession): there is nothing to abort
      // yet, but there will be. Record it so the run ends before its prompt
      // instead of refusing the user and letting the turn go ahead.
      const starting = this.#starting.get(sessionId);
      if (!starting || starting.abortRequested) return false;
      starting.abortRequested = true;
      return true;
    }
    if (run.abortState !== 'idle') return false;
    run.abortState = 'aborting';
    // Set before awaiting: the SDK emits its aborted `message_end` while
    // `session.abort()` is still in flight, and that turn must not be reported
    // back to the user as an unexpected interruption.
    run.state.abortPending = true;
    const closeAutomation = this.options.closeAutomationSession
      ?? (this.options.automationBridge
        ? (appSessionId: string) => closeGjcAutomationSession(appSessionId, this.options.automationBridge)
        : undefined);
    const automationCleanup = run.appSessionId && closeAutomation
      ? closeAutomation(run.appSessionId).catch(() => {})
      : Promise.resolve();
    try {
      await run.session.abort();
      run.askController.dispose();
      run.abortState = 'aborted';
      run.state.abortRequested = true;
      await automationCleanup;
      return true;
    } catch {
      await automationCleanup;
      run.abortState = 'idle';
      run.state.abortPending = false;
      return false;
    }
  }

  resolveGjcToolApproval(requestId: string, decision: unknown): boolean {
    for (const run of this.#runs.values()) {
      if (run.askController.resolve(requestId, decision)) return true;
    }
    return false;
  }

  async #run(runId: string, message: string, options: Record<string, unknown>, config: SdkRunConfig, writer: GjcWorkerWriter): Promise<void> {
    let active: ActiveRun | undefined;
    let runError: unknown;
    let didRunFail = false;
    let disposalError: Error | undefined;
    try {
      await this.#runInner(runId, options, config, writer, message, (value) => { active = value; });
    } catch (error) {
      // Diagnostics stay opt-in and never reach Protocol frames.
      if (process.env.GJC_BUN_ADAPTER_DEBUG === '1') {
        console.error('[gjc-bun-adapter]', error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error));
      }
      runError = error;
      didRunFail = true;
    }
    if (active) {
      active.unsubscribe();
      active.askController.dispose();
      this.#runs.delete(runId);
      try {
        await active.session.dispose();
      } catch {
        console.error('GJC SDK session disposal failed.');
        disposalError = new Error(FAILURE);
      }
    }
    if (disposalError) throw disposalError;
    if (didRunFail) throw runError;
  }

  async #runInner(runId: string, options: Record<string, unknown>, config: SdkRunConfig, writer: GjcWorkerWriter, message: string, setActive: (run: ActiveRun) => void): Promise<void> {
    {
      const resumedId = typeof options.sessionId === 'string' && options.sessionId ? options.sessionId : undefined;
      const sessionManager = resumedId
        ? await resumeManager(resumedId, config.sessionRoot)
        : SessionManager.create(config.cwd, config.sessionRoot);
      const globalSettings = this.options.settings
        ?? await this.options.loadSettings?.()
        ?? await Settings.init(
          process.env.GJC_WORKER_AGENT_DIR ? { agentDir: process.env.GJC_WORKER_AGENT_DIR } : {},
        );
      const configuredModelId = config.modelId === 'default'
        ? await configuredDefaultModelIdWithRefresh(
          globalSettings,
          this.authStorage,
          this.modelRegistry,
          config.credential,
          config.modelProfile,
        )
        : config.modelId;
      // Settings.init is process-global, but each run receives a cwd-specific
      // clone before session creation. A Bun worker can serve multiple project
      // sessions, and the clone keeps their project settings and overrides isolated.
      const settings = await globalSettings.cloneForCwd(config.cwd);
      applyGjcToolSettingsPolicy(settings);
      const askController = new GjcBunAskController(writer);
      const model = await modelForWithRefresh(this.modelRegistry, configuredModelId);
      const resolvedCredential = await credentialFor(this.authStorage, config.credential, model);
      try {
        const result = await (this.options.createSessionFactory ?? createAgentSession)({
          // The app hosts the runtime in-process; the model must not reach for
          // the gjc CLI (absent on most app installs) or hand-edit ~/.gjc when
          // asked to configure sign-in, models or permissions — those live in
          // the app's UI, and "the agent stopped instead of editing .gjc" is
          // the alternative.
          systemPrompt: (defaults: string[]) => [...defaults, GAJAE_APP_ENV_NOTE],
          cwd: config.cwd,
          sessionManager,
          settings,
          authStorage: this.authStorage,
          modelRegistry: this.modelRegistry,
          model,
          ...(
            config.effort && config.effort !== 'default' && config.effort !== 'inherit'
              ? { thinkingLevel: config.effort }
              : {}
          ),
          providerSessionId: resumedId ?? sessionManager.getSessionId(),
          ...(resolvedCredential.credentialSelector
            ? { credentialSelector: resolvedCredential.credentialSelector }
            : {}),
          toolNames: [...new Set([...config.toolNames, 'ask'])],
          spawns: config.spawns,
          bashAllowedPrefixes: config.bashPolicy.allowedPrefixes,
          ...(config.bashPolicy.restrictionProfile ? { bashRestrictionProfile: config.bashPolicy.restrictionProfile } : {}),
          hasUI: true,
          ...(config.appSessionId ? {
            automationTools: createGjcAutomationTools(
              config.appSessionId,
              askController.uiContext,
              this.options.automationBridge,
            ),
          } : {}),
        });
        if (config.modelProfile) {
          await activateModelProfile({
            session: result.session,
            modelRegistry: this.modelRegistry,
            settings,
            profileName: config.modelProfile,
          });
        } else if (config.modelId !== 'default') {
          // createAgentSession receives the requested model, but a resumed
          // session can still restore its previously configured default role
          // chain when the turn starts. Mirror the upstream CLI's explicit
          // --model startup override so the app's session pin owns both the
          // live model and the default fallback controller for this run.
          const thinkingLevel = config.effort && config.effort !== 'default' && config.effort !== 'inherit'
            ? config.effort
            : undefined;
          await result.session.setModelTemporary(model, thinkingLevel, {
            persistAsSessionDefault: true,
            cause: 'startup-override',
          });
          result.session.setConfiguredModelChain(
            'default',
            [`${model.provider}/${model.id}`],
            'startup-override',
            undefined,
            true,
          );
          result.session.seedDefaultFallbackResolution(0, []);
        }
        if (resolvedCredential.credential) writer.setCredential?.(resolvedCredential.credential);
        writer.setModel?.(model.id);
        if (result.modelFallbackMessage) throw new Error(FAILURE);
        result.setToolUIContext(askController.uiContext, true);
        if (config.permissions) {
          // The runtime's SDK permission mode defaults to `allow`, which runs
          // bash and destructive edits without a word. Switching to `prompt`
          // routes every gated call through the project's policy instead. A
          // runtime without the gate cannot honour the policy, so fail closed
          // rather than run a session the user believes is asking.
          const session: ActiveRun['session'] = result.session;
          if (typeof session.setSdkPermissionMode !== 'function' || typeof session.setSdkPermissionProvider !== 'function') {
            throw new Error(FAILURE);
          }
          session.setSdkPermissionMode('prompt');
          session.setSdkPermissionProvider(createGjcPermissionProvider(config.permissions, askController, writer));
        }
        const state: SdkRunState = { abortRequested: false, abortPending: false, terminalEmitted: false, finalError: false };
        // The adapter is the only place holding the live session, so the
        // footer snapshot is read here and handed to the event mapper.
        const unsubscribe = result.session.subscribe((event: unknown) => forwardSdkEvent(
          event,
          writer,
          state,
          () => readSessionSnapshot(result.session, sessionManager),
        ));
        const activeRun: ActiveRun = {
          session: result.session,
          sessionManager,
          unsubscribe,
          askController,
          state,
          abortState: 'idle',
          ...(config.appSessionId ? { appSessionId: config.appSessionId } : {}),
        };
        setActive(activeRun);
        this.#runs.set(runId, activeRun);
        if (this.#starting.get(runId)?.abortRequested) {
          // Aborted before it had a session. No prompt, no terminal frame
          // (the app already completed the run as aborted when the abort was
          // accepted), and no session id: an empty transcript that the next
          // turn would try to resume does not exist on disk.
          activeRun.abortState = 'aborted';
          state.abortPending = true;
          state.abortRequested = true;
          return;
        }
        if (!resumedId) writer.setSessionId?.(sessionManager.getSessionId());
        let promptMessage: string | null = message;
        const commandMatch = /^\/([^\s]+)(?:\s+(.*))?$/.exec(message.trim());
        const commandName = commandMatch?.[1];
        if (commandName && GJC_APP_BUILTIN_COMMAND_NAMES.has(commandName)) {
          const requestedExportPath = commandName === 'export' ? commandMatch?.[2]?.trim() : '';
          const output = (text: string) => {
            const content = normalizeBuiltinCommandStdout(text);
            // The upstream exporter can corrupt a nested relative path in its
            // own error text. The original command is the only authoritative
            // source, so report that rather than trying to reconstruct it.
            const corruptedExportPath = commandName === 'export'
              && requestedExportPath
              && content.includes('\uFFFD');
            const safeContent = corruptedExportPath
              ? `Failed to export "${requestedExportPath}"${content.includes('ENOENT') ? ': ENOENT' : ''}: the upstream export command returned a corrupted path.`
              : content;
            writer.send({
              kind: 'text',
              role: 'assistant',
              content: safeContent,
              isLocalCommandStdout: true,
            });
          };
          // `/export` writes through a relative path resolved against the
          // worker's process cwd, and one worker serves every session. Rebind
          // the destination to this run's own project directory before the
          // handler sees it, and refuse rather than write outside it.
          const exportPath = commandName === 'export'
            ? resolveContainedExportCommand(message, config.cwd, sessionManager.getSessionFile())
            : ({ kind: 'passthrough' } as const);
          if (exportPath.kind === 'rejected') {
            output(exportPath.reason);
            promptMessage = null;
          } else {
            const commandResult = await (this.options.executeBuiltinCommand ?? executeAcpBuiltinSlashCommand)(
              exportPath.kind === 'contained' ? exportPath.message : message,
              {
                session: result.session,
                sessionManager,
                settings,
                cwd: config.cwd,
                output,
                refreshCommands: () => {},
                reloadPlugins: async () => {},
              },
            );
            if (commandResult && 'consumed' in commandResult) {
              promptMessage = null;
            } else if (commandResult && 'prompt' in commandResult) {
              promptMessage = commandResult.prompt;
            }
          }
        }
        // The runtime's TUI titles a session from its first message with a
        // smol-model completion and records it in the transcript header. The
        // SDK session never does that on its own, so the app mirrors the TUI
        // here: the first turn of a new session, unless the user already named
        // it or opted out. The title reaches the app as a `session_title`
        // message that the server stores and never shows as chat.
        const titleTask = !resumedId && promptMessage !== null && !sessionManager.getSessionName() && !sessionTitlesDisabled()
          ? (this.options.generateSessionTitle ?? runtimeSessionTitle)(message, this.modelRegistry, settings, model)
            .then(async (title) => {
              if (!title || !(await sessionManager.setSessionName(title, 'auto'))) return;
              writer.send({ kind: 'session_title', title: sessionManager.getSessionName(), source: 'auto', sessionId: sessionManager.getSessionId() });
            })
            .catch(() => {})
          : null;
        let promptError: unknown;
        try {
          if (promptMessage !== null) {
            // Attachments ride as an <images_input> block: the title above used
            // the bare user text, the model reads the files its own way.
            await result.session.prompt(appendImagesInputTag(promptMessage, config.images));
          }
        } catch (error) {
          promptError = error;
        }
        if (titleTask) {
          let grace: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([titleTask, new Promise<void>((resolve) => { grace = setTimeout(resolve, SESSION_TITLE_GRACE_MS); })]);
          clearTimeout(grace);
        }
        forwardPromptTerminal(writer, state, promptError);
        if (promptError !== undefined) throw promptError;
      } finally {
        resolvedCredential.dispose();
      }
    }
  }
}

/**
 * The SDK's in-process tools render through a process-global theme instance that
 * only the GJC CLI entrypoints initialize. The app drives the SDK programmatically,
 * so without this the first option-bearing `ask` dereferences an undefined `theme`
 * ("undefined is not an object (evaluating 'theme.status')") and kills the worker.
 * The watcher stays off: this process owns stdout for Protocol v1 and must not grow
 * SIGWINCH or theme-file listeners.
 */
export async function ensureSdkThemeInitialized(): Promise<void> {
  if (theme) return;
  await initTheme(false);
}

export async function createGjcBunSdkAdapter(agentDir: string = process.env.GJC_WORKER_AGENT_DIR ?? ''): Promise<GjcBunSdkAdapter> {
  if (!agentDir) throw new Error(FAILURE);
  if (!installGjcCliShim() && !warnedAboutGjcCliShim) {
    warnedAboutGjcCliShim = true;
    console.warn('Could not install the bundled gjc CLI shim; bundled workflow skills may be unavailable.');
  }
  // Capture the app-owned bridge capability in trusted adapter memory, then
  // remove it before the SDK creates bash tools whose child processes inherit
  // the worker environment. The model can use the injected tools but cannot
  // print or reuse the bridge token through shell commands.
  const automationBridge = takeGjcAutomationBridgeTransport();
  const [authStorage] = await Promise.all([
    discoverAuthStorage(agentDir),
    ensureSdkThemeInitialized(),
  ]);
  const modelRegistry = new ModelRegistry(authStorage);
  await modelRegistry.refresh();
  return new GjcBunSdkAdapter(authStorage, modelRegistry, {
    loadSettings: () => Settings.init({ agentDir }),
    ...(automationBridge ? { automationBridge } : {}),
  });
}
