export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'opencode' | 'gjc';

type ProviderRole = 'default' | 'planner' | 'executor' | 'architect' | 'critic';
interface ModelEffortValue { value: string; description?: string; }
interface ModelEffort { values: ModelEffortValue[]; default?: string; }
export interface ProviderModelOption { label: string; value: string; description?: string; group?: string; roles?: Partial<Record<ProviderRole, string>>; effort?: ModelEffort; }
export interface ProviderModelsDefinition { DEFAULT: string; OPTIONS: ProviderModelOption[]; MODELS?: ProviderModelOption[]; }
export interface ProviderModelsCacheInfo { expiresAt: string; source: 'memory' | 'disk' | 'fresh'; updatedAt: string; }

export type AppTab = `plugin:${string}` | 'browser' | 'chat' | 'files' | 'git' | 'shell' | 'tasks';

export interface ProjectSession {
  id: string; title?: string; summary?: string; name?: string; createdAt?: string; created_at?: string; updated_at?: string; lastActivity?: string; messageCount?: number; provider?: LLMProvider; __provider?: LLMProvider; __projectId?: string;
  [key: string]: unknown;
}

interface ProjectSessionMeta { total?: number; hasMore?: boolean; [key: string]: unknown; }

export interface Project {
  displayName: string; fullPath: string; projectId: string; path?: string; isStarred?: boolean; origin?: 'legacy' | 'explicit' | 'auto'; sessions?: ProjectSession[]; sessionMeta?: ProjectSessionMeta;
  [key: string]: unknown;
}

export interface LoadingProgress {
  current: number; total: number; kind?: 'loading_progress'; phase?: string; currentProject?: string;
  [key: string]: unknown;
}
