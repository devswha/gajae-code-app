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

export type DiffReviewComment = { location: DiffCommentLocation; comment: string };

/**
 * A review is every pending line comment as one message, in the order they
 * were written. One comment is exactly `formatDiffComment`; more are the same
 * blocks separated by a blank line, so the agent reads them as a list of
 * findings, each anchored by its own `path:line` and quote.
 */
export function formatDiffReview(comments: readonly DiffReviewComment[]): string {
  return comments.map(({ location, comment }) => formatDiffComment(location, comment)).join('\n\n');
}
