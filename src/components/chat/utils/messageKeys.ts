import type { ChatMessage } from '../types/types';

const keyValue = (candidate: unknown) => {
  if (!['string', 'number'].includes(typeof candidate)) return null;
  const value = `${candidate}`.trim();
  return value || null;
};

/**
 * Stable, deterministic React keys for one list of messages, in order.
 *
 * `normalizedToChatMessages` keeps a message's object as long as its row is
 * the same, but a key must not depend on that: keys derived purely from the
 * ordered list (intrinsic key, disambiguated by occurrence index on
 * collision) are the same for the same message order, so React keeps DOM
 * nodes and component state across a prepend or a reconcile. Keys only need
 * to be unique among siblings, so every list - the pane, a work block's
 * body, a tool group - assigns its own from its own messages.
 */
export function assignMessageKeys(messages: readonly ChatMessage[]): (message: ChatMessage) => string {
  const keys = new WeakMap<ChatMessage, string>();
  const occurrences = new Map<string, number>();
  for (const message of messages) {
    const intrinsicKey = getIntrinsicMessageKey(message) ?? 'message-generated';
    const seen = occurrences.get(intrinsicKey) ?? 0;
    occurrences.set(intrinsicKey, seen + 1);
    keys.set(message, seen === 0 ? intrinsicKey : `${intrinsicKey}__${seen}`);
  }
  return (message) => keys.get(message) ?? getIntrinsicMessageKey(message) ?? 'message-generated';
}

export const getIntrinsicMessageKey = (message: ChatMessage): string | null => {
  const identity = [message.id, message.messageId, message.toolId, message.toolCallId, message.blobId, message.rowid, message.sequence]
    .map(keyValue)
    .find(Boolean);
  if (identity) return `message-${message.type}-${identity}`;

  const instant = new Date(message.timestamp).getTime();
  if (!Number.isFinite(instant)) return null;
  const preview = typeof message.content === 'string' ? message.content.substring(0, 48) : '';
  const tool = typeof message.toolName === 'string' ? message.toolName : '';
  return `message-${message.type}-${instant}-${tool}-${preview}`;
};
