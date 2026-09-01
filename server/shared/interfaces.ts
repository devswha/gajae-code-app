import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
  ProviderAuthStatus,
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
  ProviderSkill,
  ProviderSkillListOptions,
} from '@/shared/types.js';

export interface IProvider {
  readonly id: LLMProvider;
  readonly models: IProviderModels;
  readonly skills: IProviderSkills;
  readonly auth: IProviderAuth;
  readonly sessions: IProviderSessions;
  readonly sessionSynchronizer: IProviderSessionSynchronizer;
}

export interface IProviderSkills { listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]>; }

export interface IProviderModels {
  getSupportedModels(): Promise<ProviderModelsDefinition>;
  getCatalogRevision?(): Promise<number | null>;
  getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel>;
  changeActiveModel(input: ProviderChangeActiveModelInput): Promise<ProviderSessionActiveModelChange>;
}

export interface IProviderAuth { getStatus(): Promise<ProviderAuthStatus>; }

export interface IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[];
  fetchHistory(sessionId: string, options?: FetchHistoryOptions): Promise<FetchHistoryResult>;
}

export interface IProviderSessionSynchronizer {
  synchronize(since?: Date): Promise<number>;
  reconcile?(since?: Date, signal?: AbortSignal): Promise<{ processed: number; sessionIds: string[] }>;
  synchronizeFile(filePath: string, signal?: AbortSignal): Promise<string | null>;
}
