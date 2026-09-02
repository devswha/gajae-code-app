export type DiffCommentLocation = {
  path: string;
  oldLine: number | null;
  newLine: number | null;
  marker: '+' | '-' | ' ';
  content: string;
};

export function diffCommentLine(location: Pick<DiffCommentLocation, 'marker' | 'oldLine' | 'newLine'>): number | null {
  return location.marker === '-' ? location.oldLine : location.newLine;
}

/**
 * The message a line comment becomes: what the user said, then where, with
 * the line quoted under a `path:line` reference. A removed line carries its
 * old number and an added line its new one, which is exactly the pointer the
 * agent needs; the quote keeps the reference true even after later edits.
 */
export function formatDiffComment(location: DiffCommentLocation, comment: string): string {
  const line = diffCommentLine(location);
  const where = line === null ? location.path : `${location.path}:${line}`;
  const quoted = `> ${location.marker === ' ' ? '' : location.marker}${location.content}`.trimEnd();
  return `${comment.trim()}\n\n${where}\n${quoted}`;
}
