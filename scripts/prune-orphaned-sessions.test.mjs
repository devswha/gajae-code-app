import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCreatedAt, selectOrphanedSessions } from './prune-orphaned-sessions.mjs';

/**
 * The rows this picks are deleted and the transcripts behind them are already
 * gone, so a false positive destroys the only remaining trace of a session.
 * Each rule below exists to keep a specific kind of row out of the selection.
 */

const now = Date.parse('2026-08-26T09:00:00Z');
const hoursAgo = (hours) => new Date(now - hours * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
const missing = () => false;
const present = () => true;

test('a row whose transcript is gone is selected', () => {
  const { orphans } = selectOrphanedSessions(
    [{ session_id: 'a', jsonl_path: '/gone.jsonl', created_at: hoursAgo(5) }],
    { now, exists: missing },
  );

  assert.deepEqual(orphans.map((row) => row.session_id), ['a']);
});

test('a row with an intact transcript is left alone', () => {
  const { orphans, skipped } = selectOrphanedSessions(
    [{ session_id: 'a', jsonl_path: '/there.jsonl', created_at: hoursAgo(5) }],
    { now, exists: present },
  );

  assert.deepEqual(orphans, []);
  assert.equal(skipped.present, 1);
});

test('a row that never recorded a path is left alone', () => {
  // Absence of a path is not evidence of a missing transcript, and deleting on
  // an unproven assumption is exactly the mistake worth guarding.
  const { orphans, skipped } = selectOrphanedSessions(
    [{ session_id: 'a', jsonl_path: null, created_at: hoursAgo(5) }],
    { now, exists: missing },
  );

  assert.deepEqual(orphans, []);
  assert.equal(skipped.noPath, 1);
});

test('a session still being created is left alone', () => {
  // The row lands before the first transcript write, so a fresh session looks
  // identical to a stranded one for a moment.
  const { orphans, skipped } = selectOrphanedSessions(
    [{ session_id: 'a', jsonl_path: '/not-yet.jsonl', created_at: hoursAgo(0) }],
    { now, exists: missing },
  );

  assert.deepEqual(orphans, []);
  assert.equal(skipped.withinGrace, 1);
});

test('an unreadable creation time is treated as recent rather than deleted', () => {
  const { orphans, skipped } = selectOrphanedSessions(
    [{ session_id: 'a', jsonl_path: '/gone.jsonl', created_at: 'not-a-date' }],
    { now, exists: missing },
  );

  assert.deepEqual(orphans, []);
  assert.equal(skipped.withinGrace, 1);
});

test('both stored timestamp shapes parse to the same instant', () => {
  // The sessions table carries SQLite's bare UTC stamp on some rows and a
  // zoned ISO string on others. Appending Z blindly turned the second kind
  // into NaN, which read as "too recent" and quietly spared those rows.
  const bare = parseCreatedAt('2026-08-25 13:23:02');
  const iso = parseCreatedAt('2026-08-25T13:23:02.000Z');

  assert.equal(Number.isFinite(bare), true);
  assert.equal(bare, iso);
  assert.equal(parseCreatedAt('2026-08-25T13:23:02+09:00'), Date.parse('2026-08-25T04:23:02Z'));
  assert.equal(Number.isFinite(parseCreatedAt('')), false);
  assert.equal(Number.isFinite(parseCreatedAt(null)), false);
});

test('an old row stamped in ISO form is selected like a bare-stamped one', () => {
  const { orphans } = selectOrphanedSessions(
    [
      { session_id: 'bare', jsonl_path: '/gone-a.jsonl', created_at: hoursAgo(9) },
      { session_id: 'iso', jsonl_path: '/gone-b.jsonl', created_at: '2026-08-25T13:23:02.377Z' },
    ],
    { now, exists: missing },
  );

  assert.deepEqual(orphans.map((row) => row.session_id), ['bare', 'iso']);
});

test('mixed input splits without losing a row', () => {
  const rows = [
    { session_id: 'gone', jsonl_path: '/gone.jsonl', created_at: hoursAgo(9) },
    { session_id: 'kept', jsonl_path: '/kept.jsonl', created_at: hoursAgo(9) },
    { session_id: 'nopath', jsonl_path: null, created_at: hoursAgo(9) },
    { session_id: 'fresh', jsonl_path: '/fresh.jsonl', created_at: hoursAgo(0) },
  ];
  const { orphans, skipped } = selectOrphanedSessions(rows, {
    now,
    exists: (p) => p === '/kept.jsonl',
  });

  assert.deepEqual(orphans.map((row) => row.session_id), ['gone']);
  assert.equal(orphans.length + skipped.present + skipped.noPath + skipped.withinGrace, rows.length);
});
