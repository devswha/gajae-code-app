import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { ServerEvent } from '../../../contexts/WebSocketContext';
import { showCompletionTitleIndicator } from '../../../utils/pageTitleNotification';
import { playChatCompletionSound, playNotificationSound } from '../../../utils/notificationSound';
import type { MarkSessionIdle, MarkSessionProcessing } from '../../../hooks/useSessionProtection';
import type { PendingPermissionRequest } from '../types/types';
import type { ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionStore, NormalizedMessage } from '../../../stores/useSessionStore';

const requiresDecision = (request: { toolName?: unknown } | null | undefined) => request?.toolName !== 'ExitPlanMode' && request?.toolName !== 'exit_plan_mode';
const hasDecision = (requests: Array<{ toolName?: unknown }> | null | undefined) => Array.isArray(requests) && requests.some(requiresDecision);

interface UseChatRealtimeHandlersArgs {
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  provider: LLMProvider;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setSessionState?: (update: (previous: Record<string, unknown> | null) => Record<string, unknown>) => void;
  pendingPermissionRequests: PendingPermissionRequest[];
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  streamTimerRef: MutableRefObject<number | null>;
  accumulatedStreamRef: MutableRefObject<string>;
  lastSeqRef: MutableRefObject<Map<string, number>>;
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  onSessionProcessing?: MarkSessionProcessing;
  onSessionIdle?: MarkSessionIdle;
  onWebSocketReconnect?: () => void;
  onSteerResult?: (content: string, steered: boolean, sessionId: string | null) => void;
  sessionStore: SessionStore;
}

const skipsStore = new Set(['complete', 'status', 'permission_request', 'permission_cancelled']);

export function useChatRealtimeHandlers({
  subscribe, provider, selectedSession, currentSessionId, setTokenBudget, setSessionState,
  pendingPermissionRequests, setPendingPermissionRequests, streamTimerRef, accumulatedStreamRef,
  lastSeqRef, statusCheckSentAtRef, onSessionProcessing, onSessionIdle, onWebSocketReconnect,
  onSteerResult, sessionStore,
}: UseChatRealtimeHandlersArgs) {
  const displayedSession = useRef<string | null>(selectedSession?.id || currentSessionId || null);
  displayedSession.current = selectedSession?.id || currentSessionId || null;
  const pendingRequests = useRef(pendingPermissionRequests);

  useEffect(() => { pendingRequests.current = pendingPermissionRequests; }, [pendingPermissionRequests]);

  useEffect(() => {
    const stopStreamTimer = () => {
      if (streamTimerRef.current) {
        cancelAnimationFrame(streamTimerRef.current);
        streamTimerRef.current = null;
      }
    };
    const resolveSession = (event: ServerEvent) => {
      const visible = displayedSession.current;
      const sessionId = typeof event.sessionId === 'string' && event.sessionId ? event.sessionId : visible;
      if (sessionId && typeof event.seq === 'number') {
        const seen = lastSeqRef.current.get(sessionId) ?? 0;
        if (event.seq > seen) lastSeqRef.current.set(sessionId, event.seq);
      }
      return { sessionId, visible };
    };
    const commitPermissions = (next: PendingPermissionRequest[]) => {
      pendingRequests.current = next;
      setPendingPermissionRequests(next);
    };
    const flushStreaming = (sessionId: string | null | undefined, finalizeEmpty: boolean, timestamp?: unknown) => {
      stopStreamTimer();
      if (sessionId && (accumulatedStreamRef.current || finalizeEmpty)) {
        if (accumulatedStreamRef.current) {
          sessionStore.updateStreaming(sessionId, accumulatedStreamRef.current, provider, timestamp);
        }
        sessionStore.finalizeStreaming(sessionId);
      }
      accumulatedStreamRef.current = '';
    };

    const receive = (event: ServerEvent) => {
      if (!event.kind) return;
      const { sessionId, visible } = resolveSession(event);
      // Subscription responses may race and replay the same frames twice.
      // Deduplicate before converting stream_end into a new synthetic text id.
      if (sessionId && !sessionStore.acceptRealtimeEvent(sessionId, event.id)) return;

      if (event.kind === 'websocket_reconnected') {
        onWebSocketReconnect?.();
        return;
      }
      if (event.kind === 'chat_subscribed') {
        if (!sessionId) return;
        if (event.isProcessing) {
          onSessionProcessing?.(sessionId);
        } else {
          onSessionIdle?.(sessionId, { ifStartedBefore: statusCheckSentAtRef.current.get(sessionId) });
        }
        if (sessionId === visible && Array.isArray(event.pendingPermissions)) {
          const next = event.pendingPermissions as PendingPermissionRequest[];
          const notify = hasDecision(next) && !hasDecision(pendingRequests.current);
          commitPermissions(next);
          if (notify) void playNotificationSound();
        }
        return;
      }
      if (event.kind === 'chat_steered') {
        const content = typeof event.content === 'string' ? event.content : '';
        if (content) onSteerResult?.(content, event.steered === true, sessionId);
        return;
      }
      if (event.kind === 'protocol_error') {
        console.error('[Chat] Protocol error:', event.code, event.error);
        if (sessionId) {
          onSessionIdle?.(sessionId);
          sessionStore.appendRealtime(sessionId, {
            id: `protocol_error_${Date.now()}`, sessionId, timestamp: new Date().toISOString(), provider,
            kind: 'error', content: String(event.error || 'Request failed'),
          } as NormalizedMessage);
        }
        return;
      }
      if (event.kind === 'session_upserted' || event.kind === 'loading_progress') return;

      if (event.kind === 'stream_delta') {
        const content = (event.content as string) || '';
        if (!content) return;
        // Only the displayed session owns the composer's stream accumulator.
        // Other subscribed runs keep their deltas in their own store window.
        if (sessionId !== visible) {
          if (sessionId) sessionStore.appendRealtime(sessionId, event as unknown as NormalizedMessage);
          return;
        }
        accumulatedStreamRef.current += content;
        // Deltas land many times a frame; one paint per frame carries them
        // all. A fixed 100 ms timer painted the answer in ten steps a second,
        // which read as stutter, and a hidden tab paints nothing until it
        // is looked at again (`stream_end` flushes regardless).
        if (!streamTimerRef.current) {
          streamTimerRef.current = requestAnimationFrame(() => {
            streamTimerRef.current = null;
            if (sessionId) sessionStore.updateStreaming(sessionId, accumulatedStreamRef.current, provider, event.timestamp);
          });
        }
        return;
      }
      if (event.kind === 'stream_end') {
        // The frame carries the whole answer. It outranks the deltas: a viewer
        // that joined mid-turn holds only the tail of them, and a turn the SDK
        // did not stream has none at all - without this the answer stayed on
        // disk until the next full reload.
        const content = typeof event.content === 'string' ? event.content : '';
        if (sessionId !== visible) {
          if (sessionId) {
            // A formerly visible session can still own a reserved streaming
            // row. Retire it even on an empty end so the next turn gets a new
            // position and timestamp, without touching the visible accumulator.
            if (content) sessionStore.updateStreaming(sessionId, content, provider, event.timestamp);
            sessionStore.finalizeStreaming(sessionId);
          }
          return;
        }
        if (content) accumulatedStreamRef.current = content;
        flushStreaming(sessionId, true, event.timestamp);
        return;
      }

      if (sessionId && !skipsStore.has(event.kind)) sessionStore.appendRealtime(sessionId, event as unknown as NormalizedMessage);

      if (event.kind === 'complete') {
        if (sessionId === visible) flushStreaming(sessionId, false);
        onSessionIdle?.(sessionId);
        if (sessionId === visible) commitPermissions([]);
        if (event.aborted) return;
        if (event.success !== false) {
          showCompletionTitleIndicator();
          void playChatCompletionSound();
        }
        if (sessionId && sessionId === visible) void sessionStore.refreshFromServer(sessionId);
        return;
      }
      if (event.kind === 'permission_request') {
        if (!event.requestId) return;
        if (requiresDecision({ toolName: event.toolName })) void playNotificationSound();
        if (sessionId === visible) {
          const previous = pendingRequests.current;
          if (!previous.some((request) => request.requestId === event.requestId)) {
            commitPermissions([...previous, {
              requestId: event.requestId as string,
              toolName: (event.toolName as string) || 'UnknownTool',
              input: event.input,
              context: event.context,
              sessionId: sessionId || null,
              receivedAt: new Date(),
            }]);
          }
        }
        if (sessionId) onSessionProcessing?.(sessionId);
        return;
      }
      if (event.kind === 'permission_cancelled') {
        if (event.requestId && sessionId === visible) {
          commitPermissions(pendingRequests.current.filter((request) => request.requestId !== event.requestId));
        }
        return;
      }
      if (event.kind === 'status') {
        if (event.text === 'token_budget' && event.tokenBudget) {
          if (sessionId === visible) setTokenBudget(event.tokenBudget as Record<string, unknown>);
        } else if (event.text === 'session_state' && event.sessionState) {
          if (sessionId === visible) setSessionState?.((previous) => ({ ...(previous ?? {}), ...(event.sessionState as Record<string, unknown>) }));
        } else if (typeof event.text === 'string' && sessionId) {
          onSessionProcessing?.(sessionId, { statusText: event.text || null, canInterrupt: event.canInterrupt !== false });
        }
      }
    };

    return subscribe(receive);
  }, [
    subscribe, provider, selectedSession, currentSessionId, setTokenBudget, setSessionState,
    pendingPermissionRequests, setPendingPermissionRequests, streamTimerRef, accumulatedStreamRef,
    lastSeqRef, statusCheckSentAtRef, onSessionProcessing, onSessionIdle, onWebSocketReconnect,
    onSteerResult, sessionStore,
  ]);
}
