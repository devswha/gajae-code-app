import { getConnection } from '@/modules/database/connection.js';

export type SessionWorktreeRow = { session_id: string; job_id: string; repository_root: string; worktree_path: string | null };

export const sessionWorktreesDb = {
  get(sessionId: string): SessionWorktreeRow | null {
    return getConnection().prepare('SELECT session_id, job_id, repository_root, worktree_path FROM session_worktrees WHERE session_id = ?').get(sessionId) as SessionWorktreeRow | undefined ?? null;
  },
  create(sessionId: string, jobId: string, repositoryRoot: string): void {
    getConnection().prepare('INSERT INTO session_worktrees (session_id, job_id, repository_root) VALUES (?, ?, ?)').run(sessionId, jobId, repositoryRoot);
  },
  setPreparedPath(sessionId: string, jobId: string, cwd: string): void {
    const result = getConnection().prepare('UPDATE session_worktrees SET worktree_path = ? WHERE session_id = ? AND job_id = ? AND (worktree_path IS NULL OR worktree_path = ?)').run(cwd, sessionId, jobId, cwd);
    if (result.changes !== 1) throw new Error('Session worktree binding changed during preparation.');
  },
};
