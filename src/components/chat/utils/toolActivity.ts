import type { ChatMessage } from '../types/types';
import { getToolConfig } from '../tools/configs/toolConfigs';

/**
 * What the agent is doing right now, read off the transcript.
 *
 * The activity line used to rotate through six decorative verbs on a timer.
 * The client already receives every tool call as it starts and every result
 * as it lands, so the line can say what is actually happening: the running
 * tool and its subject, the pending approval, or - with no tool in flight -
 * that the model is generating. Everything here is a pure function of the
 * message list so it can be tested on synthetic sequences; the turn's work
 * block (and the bare running row at detailed density) renders it.
 */

export type ToolCategory = 'read' | 'search' | 'command' | 'edit' | 'write' | 'web' | 'subagent' | 'other';

/**
 * Keyed by the runtime's own lowercase names first (the GJC catalog: `read`,
 * `bash`, `edit`, `task`, ...), with the Claude-shaped capitalised names that
 * stored transcripts from other agents still carry.
 */
const CATEGORY_BY_TOOL: Record<string, ToolCategory> = {
  read: 'read', Read: 'read',
  search: 'search', find: 'search', ast_grep: 'search', lsp: 'search', Grep: 'search', Glob: 'search',
  bash: 'command', Bash: 'command',
  edit: 'edit', ast_edit: 'edit', Edit: 'edit', MultiEdit: 'edit', ApplyPatch: 'edit',
  write: 'write', Write: 'write',
  web_search: 'web', browser: 'web', WebSearch: 'web', WebFetch: 'web',
  task: 'subagent', Task: 'subagent',
};

export function categorizeTool(message: Pick<ChatMessage, 'toolName' | 'isSubagentContainer'>): ToolCategory {
  if (message.isSubagentContainer) return 'subagent';
  return CATEGORY_BY_TOOL[message.toolName || ''] ?? 'other';
}

export function parseToolInput(toolInput: unknown): unknown {
  if (typeof toolInput !== 'string') return toolInput;
  try {
    return JSON.parse(toolInput);
  } catch {
    return toolInput;
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const firstLine = (value: unknown): string => String(value ?? '').split('\n')[0].trim();

/**
 * The one thing a call is about: the file, the command, the pattern. Reads the
 * same `getValue`/`title` accessors the tool cards use for their own titles,
 * then falls back to the fields the runtime's schema names, so the activity
 * line and the card never disagree about what a call touched.
 */
export function describeToolSubject(toolName: string, toolInput: unknown): string {
  const config = getToolConfig(toolName).input;
  const parsed = parseToolInput(toolInput);
  const fields = asRecord(parsed);

  const fromAccessor = config.getValue?.(parsed);
  if (fromAccessor) return String(fromAccessor).trim();
  if (fields) {
    const path = fields.path ?? fields.file_path;
    if (typeof path === 'string' && path.trim()) return path.trim();
    if (typeof fields.command === 'string' && fields.command.trim()) return firstLine(fields.command);
  }
  if (typeof config.title === 'function') return String(config.title(parsed) ?? '').trim();
  return '';
}

/** The UI label a subagent call was given; the runtime's `task` batches several. */
export function describeSubagent(toolInput: unknown): string {
  const fields = asRecord(parseToolInput(toolInput));
  if (!fields) return '';
  if (typeof fields.description === 'string' && fields.description.trim()) return fields.description.trim();
  if (Array.isArray(fields.tasks)) {
    const labels = fields.tasks
      .map((task) => {
        const record = asRecord(task);
        return record ? String(record.description || record.id || '').trim() : '';
      })
      .filter(Boolean);
    if (labels.length) return labels.join(', ');
  }
  const kind = fields.subagent_type ?? fields.agent;
  return typeof kind === 'string' ? kind.trim() : '';
}

export type LiveActivity =
  | { kind: 'status'; text: string }
  | { kind: 'awaiting_input' }
  | { kind: 'thinking' }
  /** No tool in flight and the answer's text is streaming in. */
  | { kind: 'responding' }
  | { kind: 'tool'; category: Exclude<ToolCategory, 'subagent'>; toolName: string; subject: string; moreCount: number }
  | { kind: 'subagent'; description: string; moreCount: number };

export interface LiveActivityContext {
  /** A server-sent status line (compaction, retries); shown verbatim when present. */
  statusText?: string | null;
  /** An approval or question is open that nobody has answered. */
  awaitingInput?: boolean;
}

const isUserTurnStart = (message: ChatMessage): boolean => message.type === 'user' && !message.isSystemNotice;

/** Everything after the last user message: the turn the agent is working on. */
export function currentTurnMessages(messages: ChatMessage[]): ChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isUserTurnStart(messages[index])) return messages.slice(index + 1);
  }
  return messages;
}

/**
 * A call is in flight until its result lands. A subagent container is in
 * flight until the task reports completion, whatever its child tools did.
 */
export const isToolCallRunning = (message: ChatMessage): boolean => {
  if (!message.isToolUse) return false;
  if (message.isSubagentContainer) return !message.toolResult && !message.subagentState?.isComplete;
  return !message.toolResult;
};

export function runningToolCalls(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(isToolCallRunning);
}

/** Prose still arriving: the model is writing its answer rather than deciding what to do. */
const isStreamingAnswer = (message: ChatMessage | undefined): boolean =>
  Boolean(message && message.type === 'assistant' && message.isStreaming && !message.isToolUse && !message.isThinking);

/**
 * Precedence: what the server says outranks what the transcript implies, and
 * a pending approval outranks a running tool, because the run is stopped on
 * it. Otherwise the most recently started tool speaks for the run, with a
 * count of the others still going. With nothing in flight, the run is either
 * writing its answer (text is streaming in) or thinking about its next move.
 */
export function deriveLiveActivity(messages: ChatMessage[], context: LiveActivityContext = {}): LiveActivity {
  const statusText = context.statusText?.trim();
  if (statusText) return { kind: 'status', text: statusText.replace(/\.+$/, '') };
  if (context.awaitingInput) return { kind: 'awaiting_input' };

  const turn = currentTurnMessages(messages);
  const running = runningToolCalls(turn);
  if (running.length === 0) return isStreamingAnswer(turn[turn.length - 1]) ? { kind: 'responding' } : { kind: 'thinking' };

  const latest = running[running.length - 1];
  const moreCount = running.length - 1;
  const toolName = latest.toolName || 'UnknownTool';
  const category = categorizeTool(latest);
  if (category === 'subagent') {
    return { kind: 'subagent', description: describeSubagent(latest.toolInput), moreCount };
  }
  return { kind: 'tool', category, toolName, subject: describeToolSubject(toolName, latest.toolInput), moreCount };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const WEB_SEARCH_TOOLS = new Set(['web_search', 'WebSearch']);

function verbKey(activity: Extract<LiveActivity, { kind: 'tool' }>): string {
  switch (activity.category) {
    case 'read': return 'reading';
    case 'search': return 'searching';
    case 'command': return 'running';
    case 'edit': return 'editing';
    case 'write': return 'writing';
    case 'web': return WEB_SEARCH_TOOLS.has(activity.toolName) ? 'searchingWeb' : 'browsing';
    default: return 'using';
  }
}

/** The label a tool card shows for this tool, when it has one; the raw name otherwise. */
export function toolDisplayLabel(toolName: string): string {
  return getToolConfig(toolName).input.label || toolName;
}

/**
 * Renders an activity as one line under `chat:activity.*`. The subject of a
 * search is quoted because a pattern reads as prose without it
 * (`Searching "useSession"`); a path or a command stands on its own.
 */
export function formatLiveActivity(activity: LiveActivity, t: Translate): string {
  switch (activity.kind) {
    case 'status':
      return activity.text;
    case 'awaiting_input':
      return t('activity.awaitingApproval', { defaultValue: 'Waiting for your approval' });
    case 'thinking':
      return t('activity.thinking', { defaultValue: 'Thinking' });
    case 'responding':
      return t('activity.responding', { defaultValue: 'Writing answer' });
    case 'subagent': {
      const base = activity.description
        ? t('activity.subagent', { description: activity.description, defaultValue: 'Subagent: {{description}}' })
        : t('activity.subagentRunning', { defaultValue: 'Subagent running' });
      return withMore(base, activity.moreCount, t);
    }
    case 'tool': {
      const verb = verbKey(activity);
      const tool = toolDisplayLabel(activity.toolName);
      const subject = activity.category === 'search' && activity.subject ? `"${activity.subject}"` : activity.subject;
      let base: string;
      if (verb === 'using' || !subject) {
        base = subject
          ? t('activity.usingWith', { tool, subject, defaultValue: '{{tool}}: {{subject}}' })
          : t('activity.using', { tool, defaultValue: 'Using {{tool}}' });
      } else {
        base = t(`activity.${verb}`, { subject, defaultValue: `${verb} {{subject}}` });
      }
      return withMore(base, activity.moreCount, t);
    }
  }
}

function withMore(base: string, moreCount: number, t: Translate): string {
  if (moreCount <= 0) return base;
  return `${base} ${t('activity.more', { count: moreCount, defaultValue: '+{{count}} more' })}`;
}
