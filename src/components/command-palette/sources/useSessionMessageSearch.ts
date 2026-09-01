import { useEffect, useRef, useState } from 'react';

import type { LLMProvider } from '../../../types/app';
import { api } from '../../../utils/api';

export type SessionMessageMatch = { sessionId: string; label: string; snippet: string; provider: LLMProvider };
type ProjectResult = {
  projectId: string | null;
  projectName: string;
  sessions: Array<{ sessionId: string; provider: LLMProvider; sessionSummary: string; matches: Array<{ snippet: string }> }>;
};

const QUERY_THRESHOLD = 2;
const SEARCH_DELAY = 250;

function resultsFrom(event: Event, projectId: string): SessionMessageMatch[] | undefined {
  const payload = JSON.parse((event as MessageEvent).data) as { projectResult: ProjectResult };
  const result = payload.projectResult;
  if (result.projectId !== projectId) return undefined;
  return result.sessions.map((session) => ({
    sessionId: session.sessionId,
    label: session.sessionSummary || session.sessionId,
    snippet: session.matches.at(0)?.snippet ?? '',
    provider: session.provider,
  }));
}

export function useSessionMessageSearch(projectId: string | undefined, query: string, enabled: boolean) {
  const [matches, setMatches] = useState<SessionMessageMatch[]>([]);
  const generation = useRef(0);
  const connection = useRef<EventSource | null>(null);

  useEffect(() => {
    const phrase = query.trim();
    const canSearch = enabled && Boolean(projectId) && phrase.length >= QUERY_THRESHOLD;
    if (!canSearch) {
      setMatches([]);
      connection.current?.close();
      connection.current = null;
      return;
    }

    connection.current?.close();
    connection.current = null;
    generation.current += 1;
    const timer = window.setTimeout(() => {
      const requestId = ++generation.current;
      const stream = new EventSource(api.searchConversationsUrl(phrase), { withCredentials: true });
      connection.current = stream;
      const accumulated: SessionMessageMatch[] = [];

      const finish = () => {
        if (requestId !== generation.current) return;
        stream.close();
        connection.current = null;
      };
      stream.addEventListener('result', (event) => {
        if (requestId !== generation.current) {
          stream.close();
          return;
        }
        try {
          const received = resultsFrom(event, projectId!);
          if (!received) return;
          accumulated.push(...received);
          setMatches([...accumulated]);
        } catch {
          // Ignore a malformed server-sent event and continue the stream.
        }
      });
      stream.addEventListener('done', finish);
      stream.addEventListener('error', finish);
    }, SEARCH_DELAY);

    return () => window.clearTimeout(timer);
  }, [enabled, projectId, query]);

  useEffect(() => () => {
    connection.current?.close();
    connection.current = null;
  }, []);

  return matches;
}
