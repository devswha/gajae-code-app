import type { ChatMessage } from '../types/types';

const TOOL_GROUP_THRESHOLD = 2;

export interface ToolGroupItem { _isGroup: true; toolName: string; messages: ChatMessage[]; timestamp: ChatMessage['timestamp']; }

export type MessageListItem = ChatMessage | ToolGroupItem;

export function isToolGroupItem(item: MessageListItem): item is ToolGroupItem {
  return Reflect.has(item, '_isGroup') && item._isGroup === true;
}

type NamedToolMessage = ChatMessage & { toolName: string };

const isNamedTool = (message: ChatMessage): message is NamedToolMessage =>
  Boolean(message.isToolUse && message.toolName && !message.isSubagentContainer);

const isHiddenThought = (message: ChatMessage, showThinking: boolean) =>
  Boolean(message.isThinking && !showThinking);

export function groupConsecutiveTools(
  messages: ChatMessage[],
  showThinking: boolean = true,
): MessageListItem[] {
  const display: MessageListItem[] = [];
  let cursor = 0;

  while (cursor < messages.length) {
    const first = messages[cursor];
    if (!isNamedTool(first)) {
      display.push(first);
      cursor += 1;
      continue;
    }

    const matching: ChatMessage[] = [];
    let probe = cursor;
    while (probe < messages.length) {
      const current = messages[probe];
      if (isHiddenThought(current, showThinking)) {
        probe += 1;
      } else if (isNamedTool(current) && current.toolName === first.toolName) {
        matching.push(current);
        probe += 1;
      } else {
        break;
      }
    }

    if (matching.length >= TOOL_GROUP_THRESHOLD) {
      display.push({
        _isGroup: true,
        toolName: first.toolName,
        messages: matching,
        timestamp: first.timestamp,
      });
    } else {
      display.push(...matching);
    }
    cursor = probe;
  }

  return display;
}
