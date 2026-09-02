import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../utils/api';
import type { SessionActivitySnapshot, SyncProcessingSessions } from '../../hooks/useSessionProtection';

import { parseStartedAt } from './appContentUtils';

type RunningSessionApiItem = {
  sessionId?: unknown;
  startedAt?: unknown;
  statusText?: unknown;
  canInterrupt?: unknown;
  awaitingInput?: unknown;
};

type RunningSessionsApiPayload = {
  data?: {
    sessions?: RunningSessionApiItem[];
  };
};

const RUNNING_SESSIONS_QUERY_KEY = ['running-sessions'] as const;

const RUNNING_SESSIONS_REFETCH_MS = 5000;

/**
 * Polls `/api/providers/sessions/running` on a declared interval and feeds
 * every successful snapshot into `syncProcessingSessions`.
 *
 * Two behaviors are deliberate and load-bearing:
 * - A degraded response (auth failure, server error) throws inside the
 *   queryFn, so the previous data survives and the processing map is never
 *   clobbered with an empty list.
 * - The sync effect keys on `dataUpdatedAt`, not on data identity: Query's
 *   structural sharing keeps `data` referentially stable across identical
 *   payloads, but `useSessionProtection` relies on *every* poll reaching it
 *   so its local-activity grace window can expire entries the server never
 *   reported.
 */
export function useRunningSessionsSync(syncProcessingSessions: SyncProcessingSessions) {
  const { data, dataUpdatedAt } = useQuery({
    queryKey: RUNNING_SESSIONS_QUERY_KEY,
    queryFn: async (): Promise<SessionActivitySnapshot[]> => {
      const response = await api.runningSessions();
      if (!response.ok) {
        throw new Error('running sessions fetch degraded');
      }

      const payload = (await response.json()) as RunningSessionsApiPayload;
      const sessions = Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];

      return sessions
        .map((session): SessionActivitySnapshot | null => {
          if (typeof session.sessionId !== 'string' || !session.sessionId) {
            return null;
          }

          return {
            sessionId: session.sessionId,
            startedAt: parseStartedAt(session.startedAt),
            statusText: typeof session.statusText === 'string' ? session.statusText : undefined,
            canInterrupt: typeof session.canInterrupt === 'boolean' ? session.canInterrupt : undefined,
            awaitingInput: typeof session.awaitingInput === 'boolean' ? session.awaitingInput : undefined,
          };
        })
        .filter((session): session is SessionActivitySnapshot => session !== null);
    },
    refetchInterval: RUNNING_SESSIONS_REFETCH_MS,
  });

  useEffect(() => {
    if (data) {
      syncProcessingSessions(data);
    }
  }, [data, dataUpdatedAt, syncProcessingSessions]);
}
