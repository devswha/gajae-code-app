export type UnifiedDiffRow =
  | { kind: 'hunk'; content: string }
  | { kind: 'context' | 'added' | 'removed'; content: string; oldLine: number | null; newLine: number | null };

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parses the displayable portion of a unified diff without interpreting file contents. */
export function parseUnifiedDiff(patch: string): UnifiedDiffRow[] {
  const rows: UnifiedDiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of patch.split('\n')) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      inHunk = true;
      rows.push({ kind: 'hunk', content: line });
      continue;
    }
    if (!inHunk || line === '\\ No newline at end of file') {
      continue;
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'added', content: line.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'removed', content: line.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      rows.push({ kind: 'context', content: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return rows;
}
