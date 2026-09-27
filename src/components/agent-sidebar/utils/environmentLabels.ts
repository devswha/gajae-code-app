/**
 * A conversation's own worktree is `<repo>/.gjc-worktrees/job-session-<uuid>`
 * on branch `job/job-session-<uuid>`. Those names are for git; shown raw they
 * fill the panel with a UUID twice. These turn them into what a person needs
 * to recognise - the repository, and a short id - while the row keeps the
 * full value in its tooltip.
 */

const SESSION_JOB = /job-session-([0-9a-f]{8})[0-9a-f-]*/i;

/** The last path segment; a trailing slash does not make the name empty. */
export function leafName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path;
}

/** `/repo/.gjc-worktrees/job-session-…` -> `{ repository: 'repo' }`; other paths -> null. */
export function sessionWorktreeOf(path: string): { repository: string } | null {
  const segments = path.replace(/\/+$/, '').split('/');
  const index = segments.lastIndexOf('.gjc-worktrees');
  if (index < 1 || index !== segments.length - 2 || !SESSION_JOB.test(segments[index + 1] ?? '')) return null;
  return { repository: segments[index - 1] || path };
}

/** `job/job-session-a03ab805-…` -> `job/a03ab805`; any other branch unchanged. */
export function displayBranch(branch: string): string {
  return branch.replace(SESSION_JOB, '$1');
}
