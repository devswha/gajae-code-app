/**
 * App config repository.
 *
 * Key-value store for application-level configuration that persists across
 * restarts. Values are always stored as strings; callers handle parsing.
 */

import { getConnection } from '@/modules/database/connection.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const appConfigDb = {
  /** Returns the stored value for a config key, or null if missing. */
  get(key: string): string | null {
    try {
      const db = getConnection();
      const row = db
        .prepare('SELECT value FROM app_config WHERE key = ?')
        .get(key) as { value: string } | undefined;
      return row?.value ?? null;
    } catch {
      // Swallow errors so early-startup reads do not crash.
      return null;
    }
  },

  /** Inserts or updates a config key (upsert). */
  set(key: string, value: string): void {
    const db = getConnection();
    db.prepare(
      'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
  },

};
