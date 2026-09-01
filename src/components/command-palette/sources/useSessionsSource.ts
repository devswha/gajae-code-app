import { authenticatedFetch } from '../../../utils/api';
import type { LLMProvider, ProjectSession } from '../../../types/app';

import { useApiSource } from './useApiSource';

export type SessionResult = { id: string; label: string; provider?: LLMProvider };
type SessionsResponse = { sessions?: ProjectSession[] };

function sessionLabel(session: ProjectSession): string {
  return (session.title || session.summary || session.name || session.id) as string;
}

export function useSessionsSource(projectId: string | undefined, enabled: boolean) {
  const active = enabled && Boolean(projectId);
  return useApiSource<SessionResult, SessionsResponse>({
    enabled: active,
    deps: [projectId],
    fetcher: (signal) => {
      const query = new URLSearchParams([['limit', '50'], ['offset', '0']]);
      const route = `/api/projects/${encodeURIComponent(projectId!)}/sessions?${query}`;
      return authenticatedFetch(route, { signal });
    },
    parse: (response) => (response.sessions ?? []).map((session) => ({
      id: session.id,
      label: sessionLabel(session),
      provider: (session.__provider || session.provider) as LLMProvider | undefined,
    })),
  });
}
