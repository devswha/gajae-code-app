import type { MarkSessionIdle, MarkSessionProcessing, SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { LLMProvider, Project, ProjectSession } from '../../../types/app';

/** Old/new text a tool reported for a file edit, forwarded with file-open requests. */
export type CodeEditorDiffInfo = { old_string?: string; new_string?: string; [key: string]: unknown };

export type Provider = LLMProvider;
export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan';

export interface ChatImage { data?: string; mimeType?: string; name?: string; path?: string; }
export interface ToolResult { content?: unknown; isError?: boolean; timestamp?: string | number | Date; toolUseResult?: unknown; [key: string]: unknown; }
export interface SubagentChildTool { timestamp: Date; toolId: string; toolInput: unknown; toolName: string; toolResult?: ToolResult | null; }
interface SubagentState { childTools: SubagentChildTool[]; currentToolIndex: number; isComplete: boolean; }

export interface ChatMessage {
  timestamp: string | number | Date; type: string; sessionId?: string; content?: string; displayText?: string; images?: ChatImage[]; reasoning?: string; isThinking?: boolean; isStreaming?: boolean; isInteractivePrompt?: boolean; isToolUse?: boolean;
  toolName?: string; toolInput?: unknown; toolResult?: ToolResult | null; toolResultTruncated?: boolean; toolResultBytes?: number; toolId?: string; toolCallId?: string;
  commandName?: string; commandMessage?: string; commandArgs?: string; isLocalCommand?: boolean; isLocalCommandStdout?: boolean; isCompactSummary?: boolean; isSystemNotice?: boolean; noticeLevel?: 'info' | 'warning' | 'error'; isSubagentContainer?: boolean; subagentState?: SubagentState;
  [key: string]: unknown;
}

export interface PendingPermissionRequest { requestId: string; toolName: string; input?: unknown; context?: unknown; sessionId?: string | null; receivedAt?: Date; }
interface QuestionOption { label: string; description?: string; }
export interface Question { options: QuestionOption[]; question: string; header?: string; multiSelect?: boolean; }
export interface SessionNavigationOptions { replace?: boolean; }
export interface SessionEstablishedContext { project: Project; provider: LLMProvider; summary?: string | null; }

export interface ChatInterfaceProps {
  selectedProject: Project | null; selectedSession: ProjectSession | null; ws: WebSocket | null; sendMessage: (message: unknown) => void;
  onFileOpen?: (filePath: string, diffInfo?: CodeEditorDiffInfo | null) => void; onInputFocusChange?: (focused: boolean) => void; onSessionProcessing?: MarkSessionProcessing; onSessionIdle?: MarkSessionIdle; processingSessions?: SessionActivityMap; onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void; onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void; onShowSettings?: () => void;
  showRawParameters?: boolean; showThinking?: boolean; showImagePreviews?: boolean; sendByCtrlEnter?: boolean; newSessionTrigger?: number; onTaskClick?: (...args: unknown[]) => void;
}
