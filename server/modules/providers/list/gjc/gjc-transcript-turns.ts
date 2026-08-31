/**
 * Which turn each transcript record belongs to, and how that turn ended.
 *
 * A turn is not "everything since the last user message". Steering a running
 * turn, answering a question it asked, and resuming after compaction all put a
 * `user` record in the transcript without starting anything, and reading the
 * flat order counts every one of them as a new turn - splitting one turn's
 * changed-file card into several and anchoring revert to the wrong message.
 *
 * The transcript already carries the answer. Every record has a `parentId`, so
 * it is a lineage rather than a list, and the distinction is visible: a `user`
 * record that *roots* a segment began a turn, while a `user` record whose
 * parent is another message was injected into a turn already running.
 *
 * How the turn ended is in the transcript too, on the assistant records:
 * `stopReason` is `toolUse` while the turn is still working, and `stop`,
 * `error` or `aborted` when it is over.
 *
 * Both facts live in the file, so a reloaded conversation reports exactly what
 * it reported live. Nothing needs persisting alongside it.
 */

/**
 * The fields of a transcript record that turn assignment depends on.
 *
 * **Every** record must be passed, not only the messages. Lineage runs through
 * compaction, model changes and custom entries as well, and dropping them
 * severs the chain: measured over 36 real sessions, filtering to messages first
 * left a fifth of all records unable to reach the turn they plainly belong to.
 *
 * `role` is absent for those non-message records. They link the chain and are
 * never assigned a turn of their own.
 */
export type TranscriptTurnRecord = {
  id: string;
  parentId?: string | null;
  role?: 'user' | 'assistant' | 'toolResult' | null;
  /** Assistant records only; absent elsewhere. */
  stopReason?: string | null;
};

/** How a turn ended, or `running` while it has not. */
export type TurnStatus = 'running' | 'completed' | 'failed' | 'aborted';

export type TurnAssignment = {
  /** Id of the `user` record that began the turn. */
  turnId: string;
  status: TurnStatus;
};

/** `toolUse` means the assistant is mid-turn; the rest are terminal. */
const TERMINAL_STOP_REASONS: ReadonlyMap<string, TurnStatus> = new Map([
  ['stop', 'completed'],
  ['error', 'failed'],
  ['aborted', 'aborted'],
]);

/**
 * Assigns every record to a turn.
 *
 * Returns a map from record id to its turn. A record that descends from no
 * `user` record - which happens when a transcript is read from partway through,
 * or when compaction dropped the root - is absent from the map rather than
 * guessed at, because a wrong turn id anchors revert to the wrong message.
 */
export function assignTranscriptTurns(
  records: readonly TranscriptTurnRecord[],
): Map<string, TurnAssignment> {
  const byId = new Map<string, TranscriptTurnRecord>();
  for (const record of records) byId.set(record.id, record);

  /**
   * A `user` record begins a turn unless it was injected into one already
   * running - which is exactly when its parent is another *message*.
   *
   * The parent being a non-message record does not make it mid-turn: resuming
   * after a compaction, or after a model change, begins a turn like any other
   * prompt.
   */
  const beginsTurn = (record: TranscriptTurnRecord): boolean => {
    if (record.role !== 'user') return false;
    if (!record.parentId) return true;
    const parent = byId.get(record.parentId);
    return !parent || !parent.role;
  };

  // Walk each record up its lineage to the turn it belongs to, memoising as we
  // go: a deep chain is resolved once, not once per descendant.
  const turnOf = new Map<string, string | undefined>();
  const resolve = (record: TranscriptTurnRecord): string | undefined => {
    const seen: TranscriptTurnRecord[] = [];
    let current: TranscriptTurnRecord | undefined = record;
    let turnId: string | undefined;

    while (current) {
      const memo = turnOf.get(current.id);
      if (memo !== undefined) {
        turnId = memo;
        break;
      }
      if (beginsTurn(current)) {
        turnId = current.id;
        break;
      }
      seen.push(current);
      const parentId: string | undefined = current.parentId ?? undefined;
      // A cycle would hang this loop; a transcript should not contain one, and
      // stopping is better than not returning.
      current = parentId && !seen.some((entry) => entry.id === parentId) ? byId.get(parentId) : undefined;
    }

    for (const entry of seen) turnOf.set(entry.id, turnId);
    if (turnId !== undefined) turnOf.set(turnId, turnId);
    return turnId;
  };

  const statuses = new Map<string, TurnStatus>();
  const assignments = new Map<string, TurnAssignment>();

  for (const record of records) {
    const turnId = resolve(record);
    if (turnId === undefined) continue;
    if (!statuses.has(turnId)) statuses.set(turnId, 'running');

    // The last terminal assistant record in a turn decides it: a turn that
    // errored and was retried within itself ends as the retry ended.
    if (record.role === 'assistant' && record.stopReason) {
      const status = TERMINAL_STOP_REASONS.get(record.stopReason);
      if (status) statuses.set(turnId, status);
    }
  }

  for (const record of records) {
    // Non-message records carry the chain but are not part of any turn's
    // content, so they are linked through rather than assigned.
    if (!record.role) continue;
    const turnId = turnOf.get(record.id);
    if (turnId === undefined) continue;
    assignments.set(record.id, { turnId, status: statuses.get(turnId) ?? 'running' });
  }

  return assignments;
}
