import { useQuery } from '@tanstack/react-query';

import { authenticatedFetch } from '../../../utils/api';
import type { SessionLocation } from '../../../../shared/session-worktree-protocol';

export type { SessionLocation };

export function useSessionLocation(sessionId?: string | null) {
  return useQuery({
    queryKey: ['session-location', sessionId],
    enabled: Boolean(sessionId),
    queryFn: async ({ signal }): Promise<SessionLocation> => {
      const response = await authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId!)}/location`, { signal });
      if (!response.ok) throw new Error('Session location is unavailable.');
      return (await response.json()).data as SessionLocation;
    },
    refetchInterval: (query) => query.state.data?.mode === 'worktree' && !query.state.data.cwd ? 1000 : false,
  });
}
