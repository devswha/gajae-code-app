/**
 * The one status a sidebar row shows for a session.
 *
 * Every agent surface in 2026 converged on the same four words, so the model
 * uses them too: a session is `running`, `needs_input` (a question or approval
 * is waiting on the user), `ready` (its last run finished and nobody has looked
 * at it since), or `blocked` (its last run failed and nobody has looked at it
 * since). Everything else is `idle`.
 */
export type SessionStatus = 'running' | 'needs_input' | 'ready' | 'blocked' | 'idle';

/** How the last run of a session ended and when. `ready` = stopped, `blocked` = failed. */
export type SessionOutcome = { kind: 'ready' | 'blocked'; at: number };

export type SessionStatusFacts = {
  /** The run registry (poll or local marking) says a run is in progress. */
  running: boolean;
  /** An approval or question raised by this session is still unanswered. */
  awaitingInput: boolean;
  /** How the most recent run ended, if that is still known. */
  outcome: SessionOutcome | null;
  /** When the user last had this session open, if ever in this browser. */
  lastViewedAt: number | null;
  /** The session is open right now; nothing about it is "unread". */
  isViewed: boolean;
};

/** Sort order for anything that lists mixed statuses: what needs the user first. */
export const SESSION_STATUS_PRIORITY: readonly SessionStatus[] = ['needs_input', 'blocked', 'ready', 'running', 'idle'];

const statusRank = new Map(SESSION_STATUS_PRIORITY.map((status, index) => [status, index]));

export function compareSessionStatus(left: SessionStatus, right: SessionStatus): number {
  return (statusRank.get(left) ?? SESSION_STATUS_PRIORITY.length) - (statusRank.get(right) ?? SESSION_STATUS_PRIORITY.length);
}

/**
 * Derives the status from the facts. Precedence, top to bottom:
 *
 * 1. `needs_input` beats everything, including the open session: a question
 *    does not answer itself by being looked at.
 * 2. `running` beats a stored outcome. The outcome describes the run that just
 *    ended; once a new run has begun it is stale, not unread.
 * 3. An outcome is only `ready`/`blocked` while unread: the session is not
 *    open and the user has not opened it since the outcome was recorded.
 */
export function deriveSessionStatus(facts: SessionStatusFacts): SessionStatus {
  if (facts.awaitingInput) return 'needs_input';
  if (facts.running) return 'running';
  const { outcome } = facts;
  if (!outcome || facts.isViewed) return 'idle';
  if (facts.lastViewedAt !== null && facts.lastViewedAt >= outcome.at) return 'idle';
  return outcome.kind;
}

/** A status that asks something of the user, as opposed to merely reporting progress. */
export function needsAttention(status: SessionStatus): boolean {
  return status === 'needs_input' || status === 'blocked' || status === 'ready';
}

/**
 * Maps a `complete` event onto the outcome it should leave behind. An aborted
 * run was stopped by the user, who therefore already knows about it.
 */
export function outcomeOfCompletion(event: Record<string, unknown>, at = Date.now()): SessionOutcome | null {
  if (event.aborted === true) return null;
  return { kind: event.success === false ? 'blocked' : 'ready', at };
}
