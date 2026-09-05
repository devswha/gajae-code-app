import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { GjcGoalOperation, GjcGoalSnapshot } from '../../../../shared/gjc-goal';

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
  const pending = useRef(new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>());
  const revision = useRef(0);
  const authority = useRef({ view: '', allowed: false });
  const latestSnapshot = useRef<GjcGoalSnapshot | undefined>(undefined);
  const view = `${projectId}:${sessionId}`;
  if (authority.current.view !== view) {
    authority.current = { view, allowed: false };
    latestSnapshot.current = undefined;
  }
  const request = useCallback((input: Record<string, unknown>): Promise<unknown> => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.current.delete(requestId); reject(new Error('Goal control timed out. Refresh to check its state.')); }, 15_000);
    pending.current.set(requestId, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    if (!sendMessage({ type: 'chat.goal', sessionId, projectId, requestId, ...input })) {
      pending.current.get(requestId)?.reject(new Error('Connect to the server to control goals.'));
      pending.current.delete(requestId);
    }
  }), [projectId, sendMessage, sessionId]);

  useEffect(() => {
    const requests = pending.current;
    const unsubscribe = subscribe((event) => {
      if (event.sessionId !== sessionId) return;
      if (event.kind === 'chat_goal' && typeof event.requestId === 'string') {
        const waiting = requests.get(event.requestId);
        if (!waiting) return;
        requests.delete(event.requestId);
        if (typeof event.error === 'string') waiting.reject(new Error(event.error));
        else waiting.resolve(event.result);
      }
      if (event.kind === 'status' && event.text === 'session_state') {
        const snapshot = (event.sessionState as { goal?: GjcGoalSnapshot } | undefined)?.goal;
        if (snapshot) {
          revision.current += 1;
          latestSnapshot.current = snapshot;
          // Live frames describe the run; only this viewer's authenticated
          // query can grant controls. A second account may be a read-only viewer.
          client.setQueryData(['gjc-goal', projectId, sessionId], { ...snapshot, canControl: authority.current.allowed && snapshot.canControl });
        }
      }
      if (event.kind === 'complete') void client.invalidateQueries({ queryKey: ['gjc-goal', projectId, sessionId] });
    });
    return () => {
      unsubscribe();
      for (const request of requests.values()) request.reject(new Error('The selected session changed.'));
      requests.clear();
    };
  }, [client, projectId, sessionId, subscribe]);

  const query = useQuery({
    queryKey: key,
    enabled: Boolean(sessionId && projectId && isConnected),
    retry: false,
    queryFn: async () => {
      const before = revision.current;
      const result = await request({ operation: 'get' }) as GjcGoalSnapshot;
      authority.current.allowed = result.canControl;
      return before === revision.current || !latestSnapshot.current ? result : { ...latestSnapshot.current, canControl: result.canControl && latestSnapshot.current.canControl };
    },
  });
  const mutation = useMutation({
    mutationFn: async ({ operation, objective }: { operation: Exclude<GjcGoalOperation, 'get'>; objective?: string }) => {
      const snapshot = client.getQueryData<GjcGoalSnapshot>(key);
      if (!snapshot?.canControl) throw new Error('Goal controls are unavailable.');
      const result = await request({ operation, runId: snapshot.runId, goalId: operation === 'create' ? null : snapshot.goal?.id,
        ...(objective === undefined ? {} : { objective }) }) as GjcGoalSnapshot | { started: true };
      if ('started' in result) await client.invalidateQueries({ queryKey: key });
      else client.setQueryData(key, result);
    },
  });
  return { snapshot: query.data, pending: query.isPending || mutation.isPending, error: mutation.error?.message ?? query.error?.message,
    connected: isConnected, control: mutation.mutateAsync, refresh: () => query.refetch() };
}
