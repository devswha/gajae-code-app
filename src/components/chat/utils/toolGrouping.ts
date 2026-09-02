import type { ChatMessage } from '../types/types';

import { toolOutputDensityRules } from './toolOutputDensity';
import type { ToolOutputDensity } from './toolOutputDensity';

export interface ToolGroupItem { _isGroup: true; toolName: string; messages: ChatMessage[]; timestamp: ChatMessage['timestamp']; }

export type MessageListItem = ChatMessage | ToolGroupItem;

export function isToolGroupItem(item: MessageListItem): item is ToolGroupItem {
  return Reflect.has(item, '_isGroup') && item._isGroup === true;
}

type NamedToolMessage = ChatMessage & { toolName: string };

const isNamedTool = (message: ChatMessage): message is NamedToolMessage =>
  Boolean(message.isToolUse && message.toolName && !message.isSubagentContainer);

/** A failed or denied call. Whatever the level folds, this stays in view. */
export const hasFailedResult = (message: ChatMessage): boolean =>
  Boolean(message.toolResult?.isError);

/**
 * Folds runs of the same tool according to the density level.
 *
 * Balanced folds two or more; compact folds even a lone call into a row, so a
 * turn reads as one line per action; detailed never folds, so every call is
 * its own card. Hidden reasoning between calls (levels that do not render it)
 * must not break a run - providers interleave it freely.
 */
export function groupConsecutiveTools(
  messages: ChatMessage[],
  density: ToolOutputDensity = 'balanced',
): MessageListItem[] {
  const { groupThreshold, showReasoning } = toolOutputDensityRules(density);
  const isHiddenThought = (message: ChatMessage) => Boolean(message.isThinking && !showReasoning);
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
      if (isHiddenThought(current)) {
        probe += 1;
      } else if (isNamedTool(current) && current.toolName === first.toolName) {
        matching.push(current);
        probe += 1;
      } else {
        break;
      }
    }

    if (matching.length >= groupThreshold) {
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
