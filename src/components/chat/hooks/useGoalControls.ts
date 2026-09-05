import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { GjcGoalOperation, GjcGoalSnapshot } from '../../../../shared/gjc-goal';

type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type GoalView = {
  sessionId: string | null;
  projectId: string | null;
  pending: Map<string, PendingRequest>;
  mounted: boolean;
  revision: number;
  latest?: GjcGoalSnapshot;
  authority?: { runId: string | null; allowed: boolean };
};

function createView(sessionId: string | null, projectId: string | null): GoalView {
  return { sessionId, projectId, pending: new Map(), mounted: false, revision: 0 };
}

function authorizedSnapshot(view: GoalView, snapshot: GjcGoalSnapshot): GjcGoalSnapshot {
  return { ...snapshot, canControl: Boolean(view.authority?.allowed
    && view.authority.runId === snapshot.runId && snapshot.canControl) };
}

export function useGoalControls(sessionId: string | null, projectId: string | null) {
  return useGoalControlsWithConnection(useWebSocket(), sessionId, projectId);
}

export function useGoalControlsWithConnection(
  { subscribe, sendMessage, isConnected }: Pick<ReturnType<typeof useWebSocket>, 'subscribe' | 'sendMessage' | 'isConnected'>,
  sessionId: string | null,
  projectId: string | null,
) {
  const client = useQueryClient();
  const key = ['gjc-goal', projectId, sessionId];
  const current = useRef<GoalView>(createView(sessionId, projectId));
  if (current.current.sessionId !== sessionId || current.current.projectId !== projectId) {
    current.current = createView(sessionId, projectId);
  }
  const view = current.current;
  const request = useCallback((input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      view.pending.delete(requestId);
    };
    const waiting: PendingRequest = {
      resolve: (value) => { finish(); resolve(value); },
      reject: (error) => { finish(); reject(error); },
    };
    const abort = () => waiting.reject(new Error('Goal request cancelled.'));
    const timer = setTimeout(() => waiting.reject(new Error('Goal control timed out. Refresh to check its state.')), 15_000);
    view.pending.set(requestId, waiting);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    if (!sendMessage({ type: 'chat.goal', sessionId: view.sessionId, projectId: view.projectId, requestId, ...input })) {
      waiting.reject(new Error('Connect to the server to control goals.'));
    }
  }), [sendMessage, view]);

  useEffect(() => {
    view.mounted = true;
    return () => {
      view.mounted = false;
      // StrictMode reattaches effects synchronously. A subscription replacement
      // must not reject the query that its next attachment is still observing.
      queueMicrotask(() => {
        if (view.mounted) return;
        for (const request of view.pending.values()) request.reject(new Error('The selected session changed.'));
      });
    };
  }, [view]);

  useEffect(() => {
    const queryKey = ['gjc-goal', projectId, sessionId];
    const unsubscribe = subscribe((event) => {
      if (current.current !== view || event.sessionId !== sessionId) return;
      if (event.kind === 'chat_goal' && typeof event.requestId === 'string') {
        const waiting = view.pending.get(event.requestId);
        if (!waiting) return;
        if (typeof event.error === 'string') waiting.reject(new Error(event.error));
        else waiting.resolve(event.result);
      }
      if (event.kind === 'status' && event.text === 'session_state') {
        const snapshot = (event.sessionState as { goal?: GjcGoalSnapshot } | undefined)?.goal;
        if (snapshot) {
          const changedRun = view.latest?.runId !== snapshot.runId;
          view.revision += 1;
          view.latest = snapshot;
          if (changedRun) view.authority = undefined;
          // Live frames describe the run; only this viewer's authenticated
          // query can grant controls. A second account may be a read-only viewer.
          client.setQueryData(queryKey, authorizedSnapshot(view, snapshot));
          if (changedRun) void client.invalidateQueries({ queryKey });
        }
      }
      if (event.kind === 'complete') void client.invalidateQueries({ queryKey });
    });
    return unsubscribe;
  }, [client, projectId, sessionId, subscribe, view]);

  const query = useQuery({
    queryKey: key,
    enabled: Boolean(sessionId && projectId && isConnected),
    retry: false,
    queryFn: async ({ signal }) => {
      const before = view.revision;
      const result = await request({ operation: 'get' }, signal) as GjcGoalSnapshot;
      if (before !== view.revision && view.latest && result.runId !== view.latest.runId) {
        return authorizedSnapshot(view, view.latest);
      }
      view.authority = { runId: result.runId, allowed: result.canControl };
      if (before === view.revision || !view.latest) view.latest = result;
      return authorizedSnapshot(view, view.latest);
    },
  });
  const mutation = useMutation({
    mutationKey: key,
    mutationFn: async ({ operation, objective }: { operation: Exclude<GjcGoalOperation, 'get'>; objective?: string }) => {
      const snapshot = client.getQueryData<GjcGoalSnapshot>(key);
      if (!snapshot || !authorizedSnapshot(view, snapshot).canControl) throw new Error('Goal controls are unavailable.');
      const before = view.revision;
      const result = await request({ operation, runId: snapshot.runId, goalId: operation === 'create' ? null : snapshot.goal?.id,
        ...(objective === undefined ? {} : { objective }) }) as GjcGoalSnapshot | { started: true };
      if (current.current !== view || before !== view.revision
        || (view.latest && (view.latest.runId !== snapshot.runId || view.latest.goal?.id !== snapshot.goal?.id))) return;
      if ('started' in result) await client.invalidateQueries({ queryKey: key });
      else {
        view.revision += 1;
        view.latest = result;
        view.authority = { runId: result.runId, allowed: result.canControl };
        client.setQueryData(key, result);
      }
    },
  });
  return { snapshot: query.data ? authorizedSnapshot(view, query.data) : undefined,
    pending: query.isPending || mutation.isPending, error: mutation.error?.message ?? query.error?.message,
    connected: isConnected, control: mutation.mutateAsync, refresh: () => query.refetch() };
}
