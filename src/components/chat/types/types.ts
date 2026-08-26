import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { CodeEditorDiffInfo } from '../../code-editor/types/types';
import type {
  MarkSessionIdle,
  MarkSessionProcessing,
  SessionActivityMap,
} from '../../../hooks/useSessionProtection';

export type Provider = LLMProvider;

export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan';

export interface ChatImage {
  /** Inline data URL (Claude history stores attachments as base64). */
  data?: string;
  /** Project-relative path under `.gajae-app/assets` served via the files API. */
  path?: string;
  name?: string;
  mimeType?: string;
}

export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  toolUseResult?: unknown;
  [key: string]: unknown;
}

export interface SubagentChildTool {
  toolId: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResult | null;
  timestamp: Date;
}

export interface ChatMessage {
  sessionId?: string;
  type: string;
  content?: string;
  displayText?: string;
  timestamp: string | number | Date;
  images?: ChatImage[];
  reasoning?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  isInteractivePrompt?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolResultTruncated?: boolean;
  toolResultBytes?: number;
  toolId?: string;
  toolCallId?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  /** Agent-authored record the transcript must keep (interrupt, fallback, compaction). */
  isSystemNotice?: boolean;
  noticeLevel?: 'info' | 'warning' | 'error';
  isSubagentContainer?: boolean;
  subagentState?: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
  [key: string]: unknown;
}

export interface PendingPermissionRequest {
  requestId: string;
  toolName: string;
  input?: unknown;
  context?: unknown;
  sessionId?: string | null;
  receivedAt?: Date;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export type SessionNavigationOptions = {
  replace?: boolean;
};

export type SessionEstablishedContext = {
  provider: LLMProvider;
  project: Project;
  summary?: string | null;
};

export interface ChatInterfaceProps {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  onFileOpen?: (filePath: string, diffInfo?: CodeEditorDiffInfo | null) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  processingSessions?: SessionActivityMap;
  onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings?: () => void;
  showRawParameters?: boolean;
  showThinking?: boolean;
  showImagePreviews?: boolean;
  sendByCtrlEnter?: boolean;
  newSessionTrigger?: number;
  onTaskClick?: (...args: unknown[]) => void;
}
