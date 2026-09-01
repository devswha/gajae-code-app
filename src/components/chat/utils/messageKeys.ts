import type { ChatMessage } from '../types/types';

const keyValue = (candidate: unknown) => {
  if (!['string', 'number'].includes(typeof candidate)) return null;
  const value = `${candidate}`.trim();
  return value || null;
};

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
