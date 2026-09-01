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
type CursorRow = { last_sequence: number };
type InitializationRow = { initialized: number };

const runExclusively = <T>(work: () => T): T => {
  const database = getConnection();
  database.exec('BEGIN IMMEDIATE');

  try {
    const value = work();
    database.exec('COMMIT');
    return value;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
};

const recordCursor = (jobId: string, sequence: number): void => {
  const sql = [
    'INSERT INTO gjc_terminal_notification_scan_cursors (job_id, last_sequence, updated_at)',
    'VALUES (?, ?, CURRENT_TIMESTAMP)',
    'ON CONFLICT(job_id) DO UPDATE SET',
    'last_sequence = MAX(gjc_terminal_notification_scan_cursors.last_sequence, excluded.last_sequence),',
    'updated_at = CURRENT_TIMESTAMP',
  ].join(' ');
  getConnection().prepare(sql).run(jobId, sequence);
};

const reserveDispatch = ({
  jobId,
  eventId,
  sequence,
  runId,
  appSessionId,
  userId,
  outcome,
  claimToken,
}: GjcTerminalNotificationDispatch): boolean => {
  const sql = [
    'INSERT INTO gjc_terminal_notification_dispatches',
    '(job_id, event_id, sequence, run_id, app_session_id, user_id, outcome, status, claim_token)',
    "VALUES (?, ?, ?, ?, ?, ?, ?, 'claimed', ?)",
    'ON CONFLICT DO NOTHING',
  ].join(' ');
  return getConnection().prepare(sql).run(
    jobId, eventId, sequence, runId, appSessionId, userId, outcome, claimToken,
  ).changes === 1;
};

const cursorFor = (jobId: string): number => {
  const row = getConnection()
    .prepare('SELECT last_sequence FROM gjc_terminal_notification_scan_cursors WHERE job_id = ?')
    .get(jobId) as CursorRow | undefined;
  return row?.last_sequence ?? 0;
};

const finishDispatch = (claimToken: string, failure: string | null): void => {
  const update = failure === null
    ? "UPDATE gjc_terminal_notification_dispatches SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, failure = NULL WHERE claim_token = ? AND status = 'claimed'"
    : "UPDATE gjc_terminal_notification_dispatches SET status = 'failed', failure = ? WHERE claim_token = ? AND status = 'claimed'";
  const statement = getConnection().prepare(update);
  if (failure === null) {
    statement.run(claimToken);
  } else {
    statement.run(failure.slice(0, 512), claimToken);
  }
};

const setBaseline = (cursors: Cursor[]): boolean => runExclusively(() => {
  const database = getConnection();
  const row = database.prepare(
    'SELECT initialized FROM gjc_terminal_notification_meta WHERE id = 1',
  ).get() as InitializationRow | undefined;
  if (row?.initialized === 1) return false;

  cursors.forEach(({ jobId, lastSequence }) => recordCursor(jobId, lastSequence));
  database.prepare(
    'INSERT INTO gjc_terminal_notification_meta (id, initialized) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET initialized = 1',
  ).run();
  return true;
});

export const gjcTerminalNotificationDispatchesDb = {
  claim: (dispatch: GjcTerminalNotificationDispatch): boolean =>
    runExclusively(() => reserveDispatch(dispatch)),

  claimAndAdvanceCursor: (dispatch: GjcTerminalNotificationDispatch): boolean =>
    runExclusively(() => {
      const claimed = reserveDispatch(dispatch);
      recordCursor(dispatch.jobId, dispatch.sequence);
      return claimed;
    }),

  advanceCursor: (jobId: string, sequence: number): void => {
    runExclusively(() => recordCursor(jobId, sequence));
  },

  getCursor: cursorFor,

  initializeBaseline: setBaseline,

  markAccepted: (claimToken: string): void => {
    finishDispatch(claimToken, null);
  },

  markFailed: (claimToken: string, failure: string): void => {
    finishDispatch(claimToken, failure);
  },
};
