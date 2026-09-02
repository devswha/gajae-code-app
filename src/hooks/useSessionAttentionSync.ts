import { useEffect } from 'react';

import type { ServerEvent } from '../contexts/WebSocketContext';
import { outcomeOfCompletion } from '../stores/sessionStatusModel';
import { useSessionAttentionStore } from '../stores/useSessionAttentionStore';
import { clearCompletionTitleIndicator } from '../utils/pageTitleNotification';

import type { SessionActivityMap } from './useSessionProtection';

type UseSessionAttentionSyncArgs = {
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  /** The session the user has open, or null on the landing page. */
  viewedSessionId: string | null;
  processingSessions: SessionActivityMap;
};

/** Plan-mode exits present as approvals on the wire but ask the user nothing. */
const asksForDecision = (toolName: unknown) => toolName !== 'ExitPlanMode' && toolName !== 'exit_plan_mode';

/** Events a run emits while it is doing work; seeing one for a session means its last outcome is history. */
const LIVE_RUN_EVENTS = new Set(['stream_delta', 'text', 'tool_use', 'tool_result', 'thinking', 'status']);

const sessionOf = (event: ServerEvent): string | null => (typeof event.sessionId === 'string' && event.sessionId ? event.sessionId : null);

/**
 * Watches what the browser sends, since two of the facts the status model
 * needs only exist on the way out: answering an approval, and starting a run.
 */
export function observeOutgoingChatMessage(message: unknown): void {
  if (!message || typeof message !== 'object') return;
  const { type, requestId, sessionId } = message as Record<string, unknown>;
  const store = useSessionAttentionStore.getState();
  if (type === 'chat.permission-response' && typeof requestId === 'string') store.removePendingInput(requestId);
  if (type === 'chat.send' && typeof sessionId === 'string') store.recordOutcome(sessionId, null);
}

/**
 * Keeps the session-attention store in step with the websocket and the
 * running-sessions poll, and records the open session as viewed.
 *
 * The chat's own realtime handler only tracks approvals for the session on
 * screen; the sidebar needs them for every session, which is why this listens
 * separately rather than reaching into the chat.
 */
export function useSessionAttentionSync({ subscribe, viewedSessionId, processingSessions }: UseSessionAttentionSyncArgs): void {
  useEffect(() => {
    const receive = (event: ServerEvent) => {
      const sessionId = sessionOf(event);
      if (!sessionId || !event.kind) return;
      const store = useSessionAttentionStore.getState();

      switch (event.kind) {
        case 'permission_request': {
          if (typeof event.requestId === 'string' && asksForDecision(event.toolName)) store.addPendingInput(sessionId, event.requestId);
          return;
        }
        case 'permission_cancelled': {
          if (typeof event.requestId === 'string') store.removePendingInput(event.requestId);
          return;
        }
        case 'chat_subscribed': {
          if (!Array.isArray(event.pendingPermissions)) return;
          const requestIds = event.pendingPermissions
            .map((request) => (request && typeof request === 'object' ? request as Record<string, unknown> : null))
            .filter((request): request is Record<string, unknown> => request !== null && typeof request.requestId === 'string' && asksForDecision(request.toolName))
            .map((request) => request.requestId as string);
          store.setPendingInput(sessionId, requestIds);
          return;
        }
        case 'complete': {
          store.clearPendingInput(sessionId);
          if (sessionId === viewedSessionId) {
            store.markSessionViewed(sessionId);
            return;
          }
          store.recordOutcome(sessionId, outcomeOfCompletion(event));
          return;
        }
        case 'protocol_error': {
          // The run ended without a `complete`; the chat shows the error inline
          // and marks the session idle, so the sidebar records the failure here.
          store.clearPendingInput(sessionId);
          if (sessionId !== viewedSessionId) store.recordOutcome(sessionId, { kind: 'blocked', at: Date.now() });
          return;
        }
        default: {
          if (LIVE_RUN_EVENTS.has(event.kind) && store.outcomes[sessionId]) store.recordOutcome(sessionId, null);
        }
      }
    };
    return subscribe(receive);
  }, [subscribe, viewedSessionId]);

  useEffect(() => {
    const store = useSessionAttentionStore.getState();
    const now = Date.now();
    for (const [sessionId, activity] of processingSessions) store.reconcilePendingInput(sessionId, activity.awaitingInput, now);
    for (const sessionId of Object.keys(store.pendingInput)) {
      if (!processingSessions.has(sessionId)) store.reconcilePendingInput(sessionId, false, now);
    }
  }, [processingSessions]);

  useEffect(() => {
    if (!viewedSessionId) return;
    const store = useSessionAttentionStore.getState();
    const hadUnreadOutcome = Boolean(store.outcomes[viewedSessionId]);
    store.markSessionViewed(viewedSessionId);
    if (hadUnreadOutcome) clearCompletionTitleIndicator();
  }, [viewedSessionId]);
}
