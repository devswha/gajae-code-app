import { useEffect, useRef } from 'react';

import { classifyCommandInput, isAutoSendable } from '../components/chat/commandDispatchPolicy';
import { readQueuedMessages, type StoredQueuedMessage, writeQueuedMessages } from '../components/chat/utils/chatStorage';

import type { MarkSessionProcessing, SessionActivityMap } from './useSessionProtection';

interface UseQueuedMessageAutoSendArgs {
  processingSessions: SessionActivityMap;
  activeSessionId: string | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  markSessionProcessing: MarkSessionProcessing;
}

export type QueuedDispatchDecision =
  | { action: 'send'; content: string; options: Record<string, unknown> }
  | { action: 'hold'; reason: 'no-draft' | 'socket-closed' | 'needs-session-ui' };

const hold = (reason: Extract<QueuedDispatchDecision, { action: 'hold' }>['reason']): QueuedDispatchDecision => ({
  action: 'hold',
  reason,
});

export function decideQueuedDispatch(
  queued: StoredQueuedMessage | null | undefined,
  socketOpen: boolean,
): QueuedDispatchDecision {
  if (queued === null || queued === undefined) return hold('no-draft');
  if (!socketOpen) return hold('socket-closed');

  const command = classifyCommandInput(queued.content);
  if (!isAutoSendable(command)) return hold('needs-session-ui');

  return { action: 'send', content: queued.content, options: { ...queued.options } };
}

function completedSessionIds(
  previous: ReadonlySet<string>,
  active: ReadonlySet<string>,
  visibleSessionId: string | null,
): string[] {
  return [...previous].filter((sessionId) => !active.has(sessionId) && sessionId !== visibleSessionId);
}

export function useQueuedMessageAutoSend({
  processingSessions,
  activeSessionId,
  ws,
  sendMessage,
  markSessionProcessing,
}: UseQueuedMessageAutoSendArgs) {
  const knownProcessing = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const active = new Set(processingSessions.keys());
    const completed = completedSessionIds(knownProcessing.current, active, activeSessionId);
    knownProcessing.current = active;
    const socketOpen = ws !== null && ws.readyState === WebSocket.OPEN;

    for (const sessionId of completed) {
      const queued = readQueuedMessages(sessionId);
      const dispatch = decideQueuedDispatch(queued[0], socketOpen);
      if (dispatch.action === 'hold') continue;

      writeQueuedMessages(sessionId, queued.slice(1));
      sendMessage({
        type: 'chat.send',
        sessionId,
        content: dispatch.content,
        options: { ...dispatch.options, images: [] },
      });
      markSessionProcessing(sessionId, { statusText: null, canInterrupt: true });
    }
  }, [activeSessionId, markSessionProcessing, processingSessions, sendMessage, ws]);
}
