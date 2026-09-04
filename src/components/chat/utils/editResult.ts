import type { UnifiedDiffRow } from '../../workspace/utils/unifiedDiff.js';

/*
 * The runtime's `edit` tool has several modes (replace, patch, hashline, vim,
 * apply_patch - the last one under its own wire name), and each mode has its
 * own input shape. What every mode agrees on is the *result*: the runtime's
 * typed details carry the file's path, the operation, a rename target and a
 * numbered diff of what it actually applied - one record for a single file,
 * `perFileResults[]` for a multi-file apply_patch envelope. The app reads
 * that, so a card or the Changes tab never has to know which mode ran.
 *
 * Details reach the client as `toolResult.toolUseResult`, live and reloaded
 * alike (gjc-bun-sdk-events.ts, gjc-sessions.provider.ts).
 */

export type EditResultOp = 'create' | 'update' | 'delete';

export type EditResultFile = {
  path: string;
  op: EditResultOp;
  /** New path after a rename, when the edit moved the file. */
  move: string | null;
  /** The runtime's numbered diff (`+12|text`, `-5|text`, ` 7|text`), possibly empty. */
  diff: string;
  isError: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function fileFrom(record: Record<string, unknown>, fallbackPath: string): EditResultFile | null {
  const path = text(record.path) || fallbackPath;
  if (!path) return null;
  const op = record.op === 'create' || record.op === 'delete' ? record.op : 'update';
  return { path, op, move: text(record.move) || null, diff: text(record.diff), isError: record.isError === true };
}

/**
 * The files an edit result touched, in the order the runtime applied them.
 * Empty when the result carries no runtime details (a failed call, a foreign
 * transcript), in which case the caller falls back to the call's input.
 */
export function editResultFiles(details: unknown, fallbackPath = ''): EditResultFile[] {
  if (!isRecord(details)) return [];
  if (Array.isArray(details.perFileResults)) {
    return details.perFileResults.flatMap((entry) => (isRecord(entry) ? fileFrom(entry, '') ?? [] : []));
  }
  const single = fileFrom(details, fallbackPath);
  return single ? [single] : [];
}

const NUMBERED_LINE = /^([+\- ])(\d+)\|(.*)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * The runtime's numbered diff as rows with real line numbers: an added row
 * knows its line in the new file, a removed row its line in the old one, so
 * a comment on it lands as `path:line` like a working-tree diff. The runtime
 * numbers context rows by the old file; their new-file line follows from the
 * adds and removes before them (and the hunk header, in patch mode). Hunk
 * headers become separators; replace mode's ` N|...` elisions advance both
 * files equally and stay the context rows they print as.
 */
export function parseRuntimeDiff(diff: string): UnifiedDiffRow[] {
  const rows: UnifiedDiffRow[] = [];
  let delta = 0; // new line - old line for the next context row
  for (const line of diff.split('\n')) {
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      delta = Number(hunk[2]) - Number(hunk[1]);
      rows.push({ kind: 'hunk', content: line });
      continue;
    }
    const match = NUMBERED_LINE.exec(line);
    if (!match) continue;
    const [, prefix, number, content] = match;
    const lineNumber = Number(number);
    if (prefix === '+') {
      rows.push({ kind: 'added', content, oldLine: null, newLine: lineNumber });
      delta += 1;
    } else if (prefix === '-') {
      rows.push({ kind: 'removed', content, oldLine: lineNumber, newLine: null });
      delta -= 1;
    } else {
      rows.push({ kind: 'context', content, oldLine: lineNumber, newLine: lineNumber + delta });
    }
  }
  return rows;
}
