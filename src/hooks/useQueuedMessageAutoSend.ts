import { useEffect, useRef } from 'react';

import { classifyCommandInput, isAutoSendable } from '../components/chat/commandDispatchPolicy';
import {
  readQueuedMessages,
  writeQueuedMessages,
  type StoredQueuedMessage,
} from '../components/chat/utils/chatStorage';

import type { MarkSessionProcessing, SessionActivityMap } from './useSessionProtection';

interface UseQueuedMessageAutoSendArgs {
  processingSessions: SessionActivityMap;
  /**
   * The session currently open in the chat view. Its queued draft is owned by
   * the composer (which also handles image attachments and slash commands),
   * so this hook never touches it.
   */
  activeSessionId: string | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  markSessionProcessing: MarkSessionProcessing;
}

export type QueuedDispatchDecision =
  | { action: 'send'; content: string; options: Record<string, unknown> }
  | { action: 'hold'; reason: 'no-draft' | 'socket-closed' | 'needs-session-ui' };

/**
 * Decides what the auto-send path may do with the head of one session's queue.
 *
 * Split out from the effect because the answer is the safety-relevant part:
 * this producer has no session UI attached, so anything whose disposition
 * needs one has to stay queued. Only the head is ever considered: the messages
 * behind it are follow-ups to a turn that has not been sent yet.
 */
export function decideQueuedDispatch(
  queued: StoredQueuedMessage | null | undefined,
  socketOpen: boolean,
): QueuedDispatchDecision {
  if (!queued) return { action: 'hold', reason: 'no-draft' };

  // A closed socket would drop the send silently; keep the draft so the
  // composer (or a later completion) can retry once we're connected.
  if (!socketOpen) return { action: 'hold', reason: 'socket-closed' };

  // Slash commands are dispositioned by the owning session's composer, not
  // here. An app action would drive whichever session is currently on screen,
  // a notice has no message list to render into, and a runtime command can be
  // destructive with no confirmation surface on this path. Leaving the draft
  // in storage IS the handoff: the claim ticket stays unclaimed, and the
  // session's own composer restores and submits it through full interception
  // the moment that session is opened.
  if (!isAutoSendable(classifyCommandInput(queued.content))) {
    return { action: 'hold', reason: 'needs-session-ui' };
  }

  return { action: 'send', content: queued.content, options: { ...(queued.options ?? {}) } };
}

/**
 * Dispatches queued messages for sessions the user is NOT currently viewing.
 *
 * The composer persists each session's queue (text + send options snapshotted
 * at queue time) under `queued_message_<sessionId>`. When a session's run
 * leaves the processing map — its previous response completed — this hook sends
 * that session's next queued message instead of waiting for the user to open
 * the session again. Writing the remaining tail back before sending is the
 * claim that keeps the composer's own flush from double-sending the head.
 *
 * Only plain prose is auto-sent. A queued slash command is left in storage for
 * the owning session's composer to disposition, because acting on one here
 * would either drive an unrelated session's UI or dispatch a destructive
 * command with no confirmation surface.
 */
export function useQueuedMessageAutoSend({
  processingSessions,
  activeSessionId,
  ws,
  sendMessage,
  markSessionProcessing,
}: UseQueuedMessageAutoSendArgs) {
  const prevProcessingRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const prev = prevProcessingRef.current;
    const current = new Set(processingSessions.keys());
    prevProcessingRef.current = current;

    for (const sessionId of prev) {
      if (current.has(sessionId) || sessionId === activeSessionId) {
        continue;
      }

      const socketOpen = Boolean(ws) && ws!.readyState === WebSocket.OPEN;
      const queue = readQueuedMessages(sessionId);
      const decision = decideQueuedDispatch(queue[0], socketOpen);
      if (decision.action !== 'send') {
        continue;
      }

      // Claim the head only. The rest stay queued for the turn this send starts.
      writeQueuedMessages(sessionId, queue.slice(1));
      sendMessage({
        type: 'chat.send',
        sessionId,
        content: decision.content,
        options: { ...decision.options, images: [] },
      });
      markSessionProcessing(sessionId, { statusText: null, canInterrupt: true });
    }
  }, [processingSessions, activeSessionId, ws, sendMessage, markSessionProcessing]);
}
