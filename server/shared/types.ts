import type { IncomingMessage } from 'node:http';

export interface ApiSuccessShape<TData = unknown> { data: TData; success: true; }
export type AnyRecord = { [key: string]: any };

export interface RealtimeClientConnection { send(data: string): void; readyState: number; }
interface AuthenticatedWebSocketUser { userId?: string | number; id?: string | number; username?: string; [key: string]: unknown; }
export interface AuthenticatedWebSocketRequest extends IncomingMessage { user?: AuthenticatedWebSocketUser; }

export type LLMProvider = 'gjc';
type ProviderRole = 'default' | 'planner' | 'executor' | 'architect' | 'critic';
interface ModelEffortOption { value: string; description?: string; }
interface ModelEffort { values: ModelEffortOption[]; default?: string; }
interface ProviderModelOption { label: string; value: string; group?: string; description?: string; roles?: Partial<Record<ProviderRole, string>>; effort?: ModelEffort; }
export interface ProviderModelsDefinition { DEFAULT: string; OPTIONS: ProviderModelOption[]; MODELS?: ProviderModelOption[]; }
export interface ProviderModelsCacheInfo { source: 'memory' | 'disk' | 'fresh'; expiresAt: string; updatedAt: string; }
export interface ProviderModelsResult { cache: ProviderModelsCacheInfo; models: ProviderModelsDefinition; }
export interface ProviderSkill { command: string; description: string; name: string; scope: 'project' | 'user' | 'bundled'; sourcePath: string; }
export interface ProviderSkillListOptions { workspacePath?: string; }

export interface ProviderCurrentActiveModel { model: string; }
export interface ProviderChangeActiveModelInput { model: string; sessionId: string; }
export interface ProviderSessionActiveModelChange { changed: boolean; model: string | null; provider: LLMProvider; sessionId: string; supported: boolean; }

type MessageKind = 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'stream_delta' | 'stream_end' | 'error' | 'complete' | 'status' | 'permission_request' | 'permission_cancelled' | 'session_created' | 'session_title' | 'interactive_prompt' | 'task_notification' | 'system_notice';
interface NormalizedToolResult { content?: string; isError?: boolean; toolUseResult?: unknown; }
export interface NormalizedMessage {
  id: string; sessionId: string; timestamp: string; provider: LLMProvider; kind: MessageKind;
  seq?: number; turnId?: string; turnStatus?: 'running' | 'completed' | 'failed' | 'aborted'; role?: 'user' | 'assistant';
  content?: string; displayText?: string; commandName?: string; commandMessage?: string; commandArgs?: string; isLocalCommand?: boolean; isLocalCommandStdout?: boolean; isCompactSummary?: boolean;
  images?: unknown; toolName?: string; toolInput?: unknown; toolId?: string; toolResult?: NormalizedToolResult; toolResultTruncated?: boolean; toolResultBytes?: number; toolDetailsOmitted?: boolean;
  isError?: boolean; level?: 'info' | 'warning' | 'error'; text?: string; tokens?: number; canInterrupt?: boolean; requestId?: string; input?: unknown; context?: unknown; reason?: string; newSessionId?: string; status?: string; summary?: string; tokenBudget?: unknown; subagentTools?: unknown; toolUseResult?: unknown; sequence?: number; rowid?: number;
  [key: string]: unknown;
}

export interface FetchHistoryOptions { offset?: number; limit?: number | null; projectPath?: string; providerSessionId?: string; includeImages?: boolean; }
export interface FetchHistoryResult { hasMore: boolean; limit: number | null; messages: NormalizedMessage[]; offset: number; total: number; tokenUsage?: unknown; }
export interface AppErrorOptions { details?: unknown; statusCode?: number; code?: string; }
export interface ProviderAuthStatus { authenticated: boolean; email: string | null; error?: string; installed: boolean; method: string | null; provider: LLMProvider; }

export interface CredentialPublicRow { credential_name: string; credential_type: string; created_at: string; description: string | null; id: number; is_active: number; }
export interface CreateCredentialResult { credentialName: string; credentialType: string; id: number | bigint; }
export interface ProjectRepositoryRow { custom_project_name: string | null; isArchived: number; isStarred: number; origin: 'legacy' | 'explicit' | 'auto'; project_id: string; project_path: string; }
export type ProjectPermissionMode = 'ask' | 'auto_edits' | 'bypass';
export interface ProjectPermissionsRow { project_path: string; mode: ProjectPermissionMode; allow_always: string[]; bypass_acknowledged: boolean; updated_at: string | null; }
type CreateProjectPathOutcome = 'created' | 'reactivated_archived' | 'active_conflict';
export interface CreateProjectPathResult { project: ProjectRepositoryRow | null; outcome: CreateProjectPathOutcome; }
export interface WorkspacePathValidationResult { error?: string; resolvedPath?: string; valid: boolean; }
