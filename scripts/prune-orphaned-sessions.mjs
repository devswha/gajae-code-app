#!/usr/bin/env node
/**
 * Removes session rows whose transcript file is gone.
 *
 * The app used to write GJC transcripts under `os.tmpdir()`, which macOS reaps
 * on its own schedule. When it did, the files vanished but their database rows
 * survived, so the sidebar kept listing sessions that open empty and can never
 * render again. The root moved to `~/.gajae-app/gjc-live-sessions`, so no new
 * row can end up in this state; this clears the ones already stranded.
 *
 * Deletion is irreversible and the transcript is already gone, so the run
 * previews by default and only removes with an explicit `--apply`.
 *
 * A row is removed only when all of these hold:
 *   - it records a transcript path (a row without one cannot be proven orphaned)
 *   - that path does not exist on disk
 *   - it was created outside the grace window, so a session still being written
 *     is never mistaken for a stranded one
 *
 * Usage:
 *   node scripts/prune-orphaned-sessions.mjs            # preview
 *   node scripts/prune-orphaned-sessions.mjs --apply    # remove
 */

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

const GRACE_MS = 10 * 60 * 1000;

/**
 * Parses either stored timestamp shape. Returns NaN for anything unrecognized
 * so the caller can treat it as too recent to touch.
 */
export function parseCreatedAt(value) {
  const text = String(value ?? '').trim();
  if (!text) return Number.NaN;
  // Already zoned (trailing Z or +/-HH:MM): parse as written.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/u.test(text)) return Date.parse(text);
  // Bare SQLite timestamp: UTC by convention, so say so explicitly.
  return Date.parse(`${text.replace(' ', 'T')}Z`);
}

const databasePath = process.env.DATABASE_PATH
  || path.join(os.homedir(), '.gajae-app', 'auth.db');

/** Rows the caller may safely delete, with the reason each one qualified. */
export function selectOrphanedSessions(rows, { now = Date.now(), graceMs = GRACE_MS, exists = existsSync } = {}) {
  const orphans = [];
  const skipped = { noPath: 0, present: 0, withinGrace: 0 };

  for (const row of rows) {
    if (!row.jsonl_path) {
      skipped.noPath += 1;
      continue;
    }
    if (exists(row.jsonl_path)) {
      skipped.present += 1;
      continue;
    }
    // The column carries two shapes: SQLite's own `YYYY-MM-DD HH:MM:SS`, which
    // is UTC without saying so, and ISO strings that already carry a zone.
    // Appending Z to the latter produces `...ZZ`, which parses as NaN - and
    // since an unparseable value is treated as recent, that silently spared
    // every ISO-stamped row from selection.
    const createdAt = parseCreatedAt(row.created_at);
    if (!Number.isFinite(createdAt) || now - createdAt < graceMs) {
      skipped.withinGrace += 1;
      continue;
    }
    orphans.push(row);
  }

  return { orphans, skipped };
}

function main() {
  const apply = process.argv.includes('--apply');
  const db = new Database(databasePath, { readonly: !apply });

  try {
    const rows = db
      .prepare('SELECT session_id, provider, custom_name, project_path, jsonl_path, created_at FROM sessions')
      .all();
    const { orphans, skipped } = selectOrphanedSessions(rows);

    console.log(`database: ${databasePath}`);
    console.log(`sessions: ${rows.length}`);
    console.log(`  transcript present: ${skipped.present}`);
    console.log(`  no transcript path recorded (left alone): ${skipped.noPath}`);
    console.log(`  created within the grace window (left alone): ${skipped.withinGrace}`);
    console.log(`  transcript missing: ${orphans.length}`);

    for (const row of orphans.slice(0, 10)) {
      const name = row.custom_name || row.session_id;
      console.log(`    - ${name} (${row.provider}) ${row.project_path ?? ''}`);
    }
    if (orphans.length > 10) console.log(`    ... and ${orphans.length - 10} more`);

    if (!apply) {
      console.log('\npreview only. re-run with --apply to remove these rows.');
      return;
    }

    // One transaction: a partial prune would leave the count reported above
    // disagreeing with what the sidebar shows.
    const remove = db.prepare('DELETE FROM sessions WHERE session_id = ?');
    const removeAll = db.transaction((targets) => {
      let removed = 0;
      for (const row of targets) removed += remove.run(row.session_id).changes;
      return removed;
    });
    const removed = removeAll(orphans);

    console.log(`\nremoved ${removed} session row(s).`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
