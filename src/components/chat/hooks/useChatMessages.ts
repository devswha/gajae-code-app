import type { NormalizedMessage } from '../../../stores/useSessionStore';
import type { ChatMessage, SubagentChildTool } from '../types/types';
import { decodeHtmlEntities, unescapeWithMathProtection, formatUsageLimitText } from '../utils/chatFormatting';

type TaskNotice = { status: string; summary: string; result: string };

const toolOutputText = (value: unknown) => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const wrapped = /^<tool_use_error>([\s\S]*)<\/tool_use_error>$/.exec(serialized.trim());
  return wrapped ? wrapped[1] : serialized;
};

const readTaskNotice = (content: string): TaskNotice | null => {
  if (!content.trimStart().startsWith('<task-notification>')) return null;

  const field = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`).exec(content)?.[1]?.trim();
  const resultStart = content.indexOf('<result>');
  const resultBody = resultStart < 0 ? '' : content.slice(resultStart + 8);
  const resultEnd = resultBody.indexOf('</result>');

  return {
    status: field('status') || 'completed',
    summary: field('summary') || 'Background task finished',
    result: resultEnd < 0 ? resultBody.replace(/<\/task-notification>\s*$/, '').trim() : resultBody.slice(0, resultEnd).trim(),
  };
};

const sharedFields = (message: NormalizedMessage) => ({
  sessionId: message.sessionId,
  displayText: message.displayText,
  commandName: message.commandName,
  commandMessage: message.commandMessage,
  commandArgs: message.commandArgs,
  isLocalCommand: message.isLocalCommand,
  isLocalCommandStdout: message.isLocalCommandStdout,
  isCompactSummary: message.isCompactSummary,
});

const cleanUserText = (value: string) => unescapeWithMathProtection(decodeHtmlEntities(value));
const cleanAssistantText = (value: string) => formatUsageLimitText(cleanUserText(value));

export function normalizedToChatMessages(messages: NormalizedMessage[]): ChatMessage[] {
  const output: ChatMessage[] = [];
  const resultsByToolId = new Map<string, NormalizedMessage>();
  const knownToolIds = new Set<string>();

  for (const message of messages) {
    if (!message.toolId) continue;
    if (message.kind === 'tool_use') knownToolIds.add(message.toolId);
    if (message.kind === 'tool_result') resultsByToolId.set(message.toolId, message);
  }

  for (const message of messages) {
    const common = sharedFields(message);

    if (message.kind === 'text') {
      const content = message.content || '';
      const images = Array.isArray(message.images) && message.images.length ? message.images : undefined;
      if (!content.trim() && !images) continue;

      if (message.role !== 'user') {
        output.push({ type: 'assistant', content: cleanAssistantText(content), timestamp: message.timestamp, ...common });
        continue;
      }

      const notice = readTaskNotice(content);
      if (!notice) {
        output.push({ type: 'user', content: cleanUserText(content), timestamp: message.timestamp, images, ...common });
        continue;
      }

      output.push({
        type: 'assistant', content: notice.summary, timestamp: message.timestamp,
        isTaskNotification: true, taskStatus: notice.status, ...common,
      });
      if (notice.result) {
        output.push({ type: 'assistant', content: cleanAssistantText(notice.result), timestamp: message.timestamp, ...common });
      }
      continue;
    }

    if (message.kind === 'tool_use') {
      const attachedResult = message.toolResult || (message.toolId ? resultsByToolId.get(message.toolId) : null);
      const isTask = message.toolName === 'Task';
      const childTools: SubagentChildTool[] = isTask && Array.isArray(message.subagentTools)
        ? (message.subagentTools as any[]).map((tool) => ({
            toolId: tool.toolId,
            toolName: tool.toolName,
            toolInput: tool.toolInput,
            toolResult: tool.toolResult || null,
            timestamp: new Date(tool.timestamp || Date.now()),
          }))
        : [];
      const toolResult = attachedResult ? {
        content: toolOutputText(attachedResult.content),
        isError: Boolean(attachedResult.isError),
        toolUseResult: (attachedResult as any).toolUseResult,
        // When the result landed, so a finished turn can say how long it worked.
        timestamp: (attachedResult as { timestamp?: string }).timestamp,
      } : null;

      output.push({
        type: 'assistant', content: '', timestamp: message.timestamp, isToolUse: true,
        toolName: message.toolName,
        toolInput: typeof message.toolInput === 'string' ? message.toolInput : JSON.stringify(message.toolInput ?? '', null, 2),
        toolId: message.toolId,
        toolResult,
        toolResultTruncated: Boolean(message.toolResultTruncated || (attachedResult as { toolResultTruncated?: unknown } | null)?.toolResultTruncated),
        toolResultBytes: message.toolResultBytes ?? (attachedResult as { toolResultBytes?: number } | null)?.toolResultBytes,
        isSubagentContainer: isTask,
        subagentState: isTask ? { childTools, currentToolIndex: childTools.length ? childTools.length - 1 : -1, isComplete: Boolean(toolResult) } : undefined,
        ...common,
      });
      continue;
    }

    if (message.kind === 'thinking') {
      if (message.content?.trim()) output.push({ type: 'assistant', content: unescapeWithMathProtection(message.content), timestamp: message.timestamp, isThinking: true, ...common });
      continue;
    }
    if (message.kind === 'error') {
      output.push({ type: 'error', content: message.content || 'Unknown error', timestamp: message.timestamp, ...common });
      continue;
    }
    if (message.kind === 'system_notice') {
      const content = message.content?.trim();
      if (content) output.push({ type: 'assistant', content, timestamp: message.timestamp, isSystemNotice: true, noticeLevel: message.level ?? 'info', ...common });
      continue;
    }
    if (message.kind === 'interactive_prompt') {
      output.push({ type: 'assistant', content: message.content || '', timestamp: message.timestamp, isInteractivePrompt: true, ...common });
      continue;
    }
    if (message.kind === 'task_notification') {
      output.push({ type: 'assistant', content: message.summary || 'Background task update', timestamp: message.timestamp, isTaskNotification: true, taskStatus: message.status || 'completed', ...common });
      continue;
    }
    if (message.kind === 'stream_delta') {
      if (message.content) output.push({ type: 'assistant', content: message.content, timestamp: message.timestamp, isStreaming: true, ...common });
      continue;
    }
    if (message.kind === 'tool_result' && !message.toolId) {
      const content = toolOutputText(message.content || '');
      if (content.trim()) output.push({ type: message.isError ? 'error' : 'assistant', content, timestamp: message.timestamp, toolId: message.toolId, ...common });
      continue;
    }
    if (message.kind === 'tool_result' && message.toolId && knownToolIds.has(message.toolId)) continue;
  }

  return output;
}
