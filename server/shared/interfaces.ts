import type { FetchHistoryOptions, FetchHistoryResult, LLMProvider, NormalizedMessage, ProviderAuthStatus, ProviderChangeActiveModelInput, ProviderCurrentActiveModel, ProviderModelsDefinition, ProviderSessionActiveModelChange, ProviderSkill, ProviderSkillListOptions } from '@/shared/types.js';

//----------------- PROVIDER CONTRACT INTERFACES ------------
/**
 * Main provider contract for CLI and SDK integrations.
 *
 * Each concrete provider owns auth and session handlers plus provider-specific
 * logic for converting native events/history into the app's normalized shape.
 */
export interface IProvider {
  readonly id: LLMProvider;
  readonly models: IProviderModels;
  readonly skills: IProviderSkills;
  readonly auth: IProviderAuth;
  readonly sessions: IProviderSessions;
  readonly sessionSynchronizer: IProviderSessionSynchronizer;
}

export interface IProviderSkills {
  listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]>;
}

// ---------------------------
//----------------- PROVIDER MODEL INTERFACE ------------
/**
 * Model catalog contract for one provider.
 *
 * Implementations are responsible for resolving the provider's currently
 * supported models and converting them into the shared
 * `ProviderModelsDefinition` shape used by backend routes and frontend model
 * pickers. The `DEFAULT` field should be the most appropriate default selection
 * for that provider at the time the catalog is read.
 */
export interface IProviderModels {
  /**
   * Returns the provider's currently supported model catalog.
   */
  getSupportedModels(): Promise<ProviderModelsDefinition>;

  /**
   * Returns the currently active model for one session or provider runtime.
   *
   * Implementations must use the provider-specific lookup mechanism approved
   * for that provider and fall back only to the provider catalog default when
   * no active model can be resolved.
   */
  getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel>;

  /**
   * Persists a session-scoped model override that the next resumed turn should
   * honor for this provider.
   *
   * This does not require the provider to mutate an already running remote
   * session in-place. Instead, adapters store the user's explicit model choice
   * so the backend resume path can add the correct provider-native model option
   * on the next CLI/SDK invocation for the same session.
   */
  changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange>;
}

// ---------------------------
//----------------- PROVIDER AUTH INTERFACE ------------
/**
 * Auth contract for one provider.
 *
 * Implementations should return a complete installation/authentication status
 * without throwing for normal "not installed" or "not authenticated" states.
 */
export interface IProviderAuth {
  /**
   * Checks whether the provider is installed and has usable credentials.
   */
  getStatus(): Promise<ProviderAuthStatus>;
}

// ---------------------------
//----------------- PROVIDER SESSION INTERFACE ------------
/**
 * Session/history contract for one provider.
 *
 * Implementations normalize provider-specific events and message history into
 * shared transport shapes consumed by API routes and realtime streams.
 */
export interface IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[];
  fetchHistory(sessionId: string, options?: FetchHistoryOptions): Promise<FetchHistoryResult>;
}

// ---------------------------
//----------------- PROVIDER SESSION SYNCHRONIZER INTERFACE ------------
/**
 * Session indexing contract for one provider.
 *
 * Implementations scan provider-specific session artifacts on disk and upsert
 * normalized session metadata into the database. The service layer uses this
 * interface for both full rescans and single-file incremental sync triggered
 * by filesystem watcher events.
 */
export interface IProviderSessionSynchronizer {
  /**
   * Scans provider session artifacts and upserts discovered sessions into DB.
   */
  synchronize(since?: Date): Promise<number>;

  /**
   * Reconciles a non-durable watcher gap and returns provider-native ids whose
   * persisted metadata was refreshed. Only providers with restart recovery need it.
   */
  reconcile?(
    since?: Date,
    signal?: AbortSignal
  ): Promise<{ processed: number; sessionIds: string[] }>;

  /**
   * Parses and upserts one provider artifact file without running a full scan.
   */
  synchronizeFile(filePath: string, signal?: AbortSignal): Promise<string | null>;
}
