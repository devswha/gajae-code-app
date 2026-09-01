import { getConnection } from '@/modules/database/connection.js';

type ScanStateRow = { last_scanned_at: string };

function fromSqliteTimestamp(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

function toSqliteTimestamp(value: Date): string {
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

export const scanStateDb = {
  getLastScannedAt(): Date | null {
    const result = getConnection().prepare(
      'SELECT last_scanned_at FROM scan_state WHERE id = 1',
    ).get() as ScanStateRow | undefined;

    if (!result || !result.last_scanned_at) {
      return null;
    }

    return fromSqliteTimestamp(result.last_scanned_at);
  },

  updateLastScannedAt(scannedAt: Date = new Date()): void {
    const timestamp = toSqliteTimestamp(scannedAt);
    getConnection().prepare([
      'INSERT INTO scan_state (id, last_scanned_at)',
      'VALUES (1, ?)',
      'ON CONFLICT (id) DO UPDATE SET last_scanned_at = excluded.last_scanned_at',
    ].join(' ')).run(timestamp);
  },
};
