import { createAgentSession, discoverAuthStorage } from '@gajae-code/coding-agent/sdk/session';
import { ModelRegistry } from '@gajae-code/coding-agent/config/model-registry';
import { mergeModelProfiles, resolveProfileBindings } from '@gajae-code/coding-agent/config/model-profiles';
import { activateModelProfile } from '@gajae-code/coding-agent/config/model-profile-activation';
import { parseModelString } from '@gajae-code/coding-agent/config/model-resolver';
import { Settings } from '@gajae-code/coding-agent/config/settings';
import { AuthStorage } from '@gajae-code/coding-agent/session/auth-storage';
import { SessionManager } from '@gajae-code/coding-agent/session/session-manager';
import { executeAcpBuiltinSlashCommand } from '@gajae-code/coding-agent/slash-commands/acp-builtins';
import { initTheme, theme } from '@gajae-code/coding-agent/modes/theme/theme';

import { GjcBunOAuthController, type GjcBunOAuthControllerOptions } from './gjc-bun-oauth-controller.js';
import { GJC_APP_BUILTIN_COMMAND_NAMES } from './modules/providers/gjc-command-surface.generated.js';
import type { GjcWorkerOAuthRuntime, GjcWorkerRuntime, GjcWorkerWriter } from './gjc-worker.js';
import { GjcBunAskController } from './gjc-bun-ask-controller.js';
import { forwardPromptTerminal, forwardSdkEvent, normalizeBuiltinCommandStdout, type SdkRunState } from './gjc-bun-sdk-events.js';
import { resolveContainedExportCommand } from './gjc-export-path.js';
import { readSessionSnapshot } from './gjc-session-state.js';
type Model = ReturnType<ModelRegistry['getAll']>[number];

export type ExactCredentialRef =
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
};

export type GjcAgentSessionFactory = typeof createAgentSession;
export type GjcBunSdkAdapterOptions = {
  createSessionFactory?: GjcAgentSessionFactory;
  settings?: Settings;
  executeBuiltinCommand?: typeof executeAcpBuiltinSlashCommand;
  oauth?: GjcBunOAuthControllerOptions;
};

type ActiveRun = {
  session: { prompt(message: string): Promise<void>; abort(): Promise<void>; dispose(): Promise<void>; subscribe(listener: (event: unknown) => void): () => void };
  sessionManager: SessionManager;
  unsubscribe: () => void;
  askController: GjcBunAskController;
  state: SdkRunState;
  abortState: 'idle' | 'aborting' | 'aborted';
};

const FAILURE = 'GJC SDK configuration is invalid.';
const RUNTIME_CREDENTIAL_ENV_VARS = new Set([
  'GJC_RUNTIME_API_KEY',
]);
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
  ) throw new Error(FAILURE);
  return candidate as unknown as SdkRunConfig;
}

function modelIdFromSelector(selector: string): string {
  const parsed = parseModelString(selector);
  if (!parsed || !parsed.provider || !parsed.id) throw new Error(FAILURE);
  return `${parsed.provider}/${parsed.id}`;
}

function configuredDefaultModelId(settings: Settings, modelRegistry: ModelRegistry, modelProfile?: string): string {
  if (modelProfile) {
    const profile = modelRegistry.getModelProfile(modelProfile) ?? mergeModelProfiles().get(modelProfile);
    const selector = profile && resolveProfileBindings(profile).defaultSelector;
    if (typeof selector !== 'string' || !selector) throw new Error(FAILURE);
    return modelIdFromSelector(selector);
  }
  const roleModelId = settings.getModelRole('default');
  if (typeof roleModelId === 'string' && roleModelId) {
    return roleModelId.includes('/') ? modelIdFromSelector(roleModelId) : roleModelId;
  }

  const profileName = settings.get('modelProfile.default');
  if (typeof profileName !== 'string' || !profileName) throw new Error(FAILURE);

  // ModelRegistry loads models.yml user profiles and merges them with builtins.
  const profile = modelRegistry.getModelProfile(profileName) ?? mergeModelProfiles().get(profileName);
  const selector = profile && resolveProfileBindings(profile).defaultSelector;
  if (typeof selector !== 'string' || !selector) throw new Error(FAILURE);

  return modelIdFromSelector(selector);
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

function credentialFor(
  authStorage: AuthStorage,
  credential: ExactCredentialRef,
  model: ReturnType<ModelRegistry['getAll']>[number],
): { credentialSelector?: { provider: string; selector: { kind: 'id'; value: string }; raw: string }; credential?: { kind: 'stored'; providerId: string; credentialId: number }; dispose(): void } {
  if (credential.kind === 'stored') {
    // The provider is derived deterministically from the pinned model; an
    // explicit providerId is an assertion that must agree with it.
    if (credential.providerId !== undefined && credential.providerId !== model.provider) throw new Error(FAILURE);
    const snapshotRows: Array<{ id: number; provider: string }> = authStorage.exportSnapshot().credentials;
    const rows = snapshotRows
      .filter((row) => row.provider === model.provider)
      .sort((left, right) => left.id - right.id);
    if (rows.length === 0) throw new Error(FAILURE);
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

  spawnGjc(message: string, options: Record<string, unknown>, writer: GjcWorkerWriter): Promise<void> & { abortHandle?: string; processId?: number } {
    if (isAppOAuthCommand(message)) throw new Error(FAILURE);
    const runId = typeof options.runHandle === 'string' && options.runHandle ? options.runHandle : '';
    const config = configFromOptions(options);
    if (!runId || this.#runs.has(runId)) throw new Error(FAILURE);
    const task = this.#run(runId, message, options, config, writer);
    return Object.assign(task, { abortHandle: runId });
  }

  async abortGjcSession(sessionId: string): Promise<boolean> {
    const run = this.#runs.get(sessionId);
    if (!run || run.abortState !== 'idle') return false;
    run.abortState = 'aborting';
    // Set before awaiting: the SDK emits its aborted `message_end` while
    // `session.abort()` is still in flight, and that turn must not be reported
    // back to the user as an unexpected interruption.
    run.state.abortPending = true;
    try {
      await run.session.abort();
      run.askController.dispose();
      run.abortState = 'aborted';
      run.state.abortRequested = true;
      return true;
    } catch {
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
      const globalSettings = this.options.settings ?? await Settings.init(
        process.env.GJC_WORKER_AGENT_DIR ? { agentDir: process.env.GJC_WORKER_AGENT_DIR } : {},
      );
      const configuredModelId = config.modelId === 'default'
        ? configuredDefaultModelId(globalSettings, this.modelRegistry, config.modelProfile)
        : config.modelId;
      const settings = await globalSettings.cloneForCwd(config.cwd);
      const askController = new GjcBunAskController(writer);
      const model = await modelForWithRefresh(this.modelRegistry, configuredModelId);
      const resolvedCredential = credentialFor(this.authStorage, config.credential, model);
      try {
        const result = await (this.options.createSessionFactory ?? createAgentSession)({
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
        });
        if (config.modelProfile) {
          await activateModelProfile({
            session: result.session,
            modelRegistry: this.modelRegistry,
            settings,
            profileName: config.modelProfile,
          });
        }
        if (resolvedCredential.credential) writer.setCredential?.(resolvedCredential.credential);
        writer.setModel?.(model.id);
        if (result.modelFallbackMessage) throw new Error(FAILURE);
        result.setToolUIContext(askController.uiContext, true);
        const state: SdkRunState = { abortRequested: false, abortPending: false, terminalEmitted: false, finalError: false };
        // The adapter is the only place holding the live session, so the
        // footer snapshot is read here and handed to the event mapper.
        const unsubscribe = result.session.subscribe((event: unknown) => forwardSdkEvent(
          event,
          writer,
          state,
          () => readSessionSnapshot(result.session, sessionManager),
        ));
        const activeRun: ActiveRun = { session: result.session, sessionManager, unsubscribe, askController, state, abortState: 'idle' };
        setActive(activeRun);
        this.#runs.set(runId, activeRun);
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
        let promptError: unknown;
        try {
          if (promptMessage !== null) {
            await result.session.prompt(promptMessage);
          }
        } catch (error) {
          promptError = error;
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
  const [authStorage, settings] = await Promise.all([
    discoverAuthStorage(agentDir),
    Settings.init({ agentDir }),
    ensureSdkThemeInitialized(),
  ]);
  const modelRegistry = new ModelRegistry(authStorage);
  await modelRegistry.refresh();
  return new GjcBunSdkAdapter(authStorage, modelRegistry, { settings });
}
