import { getConnection } from '@/modules/database/connection.js';

export type GjcTerminalNotificationDispatch = {
  jobId: string;
  eventId: string;
  sequence: number;
  runId: string;
  appSessionId: string | null;
  userId: number | null;
  outcome: 'succeeded' | 'failed' | 'aborted' | 'interrupted';
  claimToken: string;
};

type Cursor = { jobId: string; lastSequence: number };

const withImmediateTransaction = <T>(operation: () => T): T => {
  const db = getConnection();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

const advanceCursor = (jobId: string, sequence: number): void => {
  getConnection().prepare(`
    INSERT INTO gjc_terminal_notification_scan_cursors (job_id, last_sequence, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(job_id) DO UPDATE SET
      last_sequence = MAX(gjc_terminal_notification_scan_cursors.last_sequence, excluded.last_sequence),
      updated_at = CURRENT_TIMESTAMP
  `).run(jobId, sequence);
};

const insertClaim = (dispatch: GjcTerminalNotificationDispatch): boolean => {
  const result = getConnection().prepare(`
    INSERT INTO gjc_terminal_notification_dispatches (
      job_id, event_id, sequence, run_id, app_session_id, user_id, outcome, status, claim_token
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'claimed', ?)
    ON CONFLICT DO NOTHING
  `).run(
    dispatch.jobId,
    dispatch.eventId,
    dispatch.sequence,
    dispatch.runId,
    dispatch.appSessionId,
    dispatch.userId,
    dispatch.outcome,
    dispatch.claimToken,
  );
  return result.changes === 1;
};

export const gjcTerminalNotificationDispatchesDb = {
  claim(dispatch: GjcTerminalNotificationDispatch): boolean {
    return withImmediateTransaction(() => insertClaim(dispatch));
  },

  claimAndAdvanceCursor(dispatch: GjcTerminalNotificationDispatch): boolean {
    return withImmediateTransaction(() => {
      const claimed = insertClaim(dispatch);
      advanceCursor(dispatch.jobId, dispatch.sequence);
      return claimed;
    });
  },

  advanceCursor(jobId: string, sequence: number): void {
    withImmediateTransaction(() => advanceCursor(jobId, sequence));
  },

  getCursor(jobId: string): number {
    const row = getConnection().prepare(
      'SELECT last_sequence FROM gjc_terminal_notification_scan_cursors WHERE job_id = ?'
    ).get(jobId) as { last_sequence: number } | undefined;
    return row?.last_sequence ?? 0;
  },

  initializeBaseline(cursors: Cursor[]): boolean {
    return withImmediateTransaction(() => {
      const db = getConnection();
      const meta = db.prepare(
        'SELECT initialized FROM gjc_terminal_notification_meta WHERE id = 1'
      ).get() as { initialized: number } | undefined;
      if (meta?.initialized === 1) return false;
      for (const cursor of cursors) advanceCursor(cursor.jobId, cursor.lastSequence);
      db.prepare(`
        INSERT INTO gjc_terminal_notification_meta (id, initialized) VALUES (1, 1)
        ON CONFLICT(id) DO UPDATE SET initialized = 1
      `).run();
      return true;
    });
  },

  markAccepted(claimToken: string): void {
    getConnection().prepare(`
      UPDATE gjc_terminal_notification_dispatches
      SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, failure = NULL
      WHERE claim_token = ? AND status = 'claimed'
    `).run(claimToken);
  },

  markFailed(claimToken: string, failure: string): void {
    getConnection().prepare(`
      UPDATE gjc_terminal_notification_dispatches
      SET status = 'failed', failure = ?
      WHERE claim_token = ? AND status = 'claimed'
    `).run(failure.slice(0, 512), claimToken);
  },
};
