import type { SessionActivityMap } from '../../../hooks/useSessionProtection';
import { deriveSessionStatus, type SessionStatus } from '../../../stores/sessionStatusModel';
import { useSessionAttentionStore } from '../../../stores/useSessionAttentionStore';

export type SessionStatusResolver = (sessionId: string) => SessionStatus;

/**
 * Joins the two places a session's status comes from - the run registry
 * (`activeSessions`) and the attention store (questions, outcomes, last
 * viewed) - into one lookup the sidebar rows can call per session.
 */
export function useSessionStatusResolver(activeSessions: SessionActivityMap, viewedSessionId: string | null): SessionStatusResolver {
  const outcomes = useSessionAttentionStore((state) => state.outcomes);
  const lastViewedAt = useSessionAttentionStore((state) => state.lastViewedAt);
  const pendingInput = useSessionAttentionStore((state) => state.pendingInput);

  return (sessionId) => {
    const activity = activeSessions.get(sessionId);
    return deriveSessionStatus({
      running: activity !== undefined,
      awaitingInput: Boolean(activity?.awaitingInput) || Boolean(pendingInput[sessionId]?.requestIds.length),
      outcome: outcomes[sessionId] ?? null,
      lastViewedAt: lastViewedAt[sessionId] ?? null,
      isViewed: sessionId === viewedSessionId,
    });
  };
}
