import { useEffect, useRef, useState } from 'react';

import type { LLMProvider } from '../../../types/app';
import { api } from '../../../utils/api';

export type SessionMessageMatch = { sessionId: string; projectId: string | null; label: string; snippet: string; provider: LLMProvider };
type ProjectResult = {
  projectId: string | null;
  projectName: string;
  sessions: Array<{ sessionId: string; provider: LLMProvider; sessionSummary: string; matches: Array<{ snippet: string }> }>;
};

const QUERY_THRESHOLD = 2;
const SEARCH_DELAY = 250;

function resultsFrom(event: Event, projectId: string | undefined): SessionMessageMatch[] | undefined {
  const payload = JSON.parse((event as MessageEvent).data) as { projectResult: ProjectResult };
  const result = payload.projectResult;
  if (projectId !== undefined && result.projectId !== projectId) return undefined;
  return result.sessions.map((session) => ({
    sessionId: session.sessionId,
    projectId: result.projectId,
    label: session.sessionSummary || session.sessionId,
    snippet: session.matches.at(0)?.snippet ?? '',
    provider: session.provider,
  }));
}

/**
 * Full-text search over conversation bodies, streamed from the server.
 *
 * Pass `projectId` to search only that project (the command palette);
 * leave it out to receive hits from every project (the sidebar filter).
 */
export function useConversationMessageSearch(query: string, enabled: boolean, projectId?: string) {
  const [matches, setMatches] = useState<SessionMessageMatch[]>([]);
  const generation = useRef(0);
  const connection = useRef<EventSource | null>(null);

  useEffect(() => {
    generation.current += 1;
    connection.current?.close();
    connection.current = null;
    setMatches([]);
    const phrase = query.trim();
    const canSearch = enabled && phrase.length >= QUERY_THRESHOLD;
    if (!canSearch) {
      return;
    }
    const timer = window.setTimeout(() => {
      const requestId = ++generation.current;
      let stream: EventSource;
      try {
        stream = new EventSource(api.searchConversationsUrl(phrase, 50, projectId), { withCredentials: true });
      } catch (error) {
        // No SSE here (an embedded shell, a test runtime): title matching still works without body hits.
        console.warn('[search] conversation body search unavailable:', error);
        return;
      }
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
          const received = resultsFrom(event, projectId);
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

    return () => {
      window.clearTimeout(timer);
      generation.current += 1;
      connection.current?.close();
      connection.current = null;
    };
  }, [enabled, projectId, query]);

  useEffect(() => () => {
    connection.current?.close();
    connection.current = null;
  }, []);

  return matches;
}

/** The palette's view: message hits within the selected project only. */
export function useSessionMessageSearch(projectId: string | undefined, query: string, enabled: boolean) {
  return useConversationMessageSearch(query, enabled && Boolean(projectId), projectId);
}
