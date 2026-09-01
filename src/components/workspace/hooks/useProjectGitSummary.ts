import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';

export type GitSummary = {
  branch: string | null;
  hasCommits: boolean;
  changed: number;
  staged: number;
  untracked: number;
};

export type GitSummaryState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; summary: GitSummary }
  | { kind: 'not-a-repository' }
  | { kind: 'unavailable' };

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

function readSummary(body: Record<string, unknown>): GitSummary {
  const branch = typeof body.branch === 'string' && body.branch.trim() ? body.branch.trim() : null;
  return {
    branch,
    hasCommits: body.hasCommits !== false,
    // Deleted files are changes too; the panel reports one working-tree number
    // rather than the per-file breakdown a manual git UI would show.
    changed: count(body.modified) + count(body.added) + count(body.deleted),
    staged: count(body.staged),
    untracked: count(body.untracked),
  };
}

/**
 * Reads the project's branch and working-tree counts.
 *
 * Fetches only while `enabled` (the Status tab being visible), because a panel
 * on another tab has no reason to shell out to git. There is no polling: the
 * summary refreshes when the project changes, when the tab is opened, and when
 * the user asks.
 */
export function useProjectGitSummary(projectId: string | undefined, enabled: boolean) {
  const [state, setState] = useState<GitSummaryState>({ kind: 'idle' });
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!projectId) {
      setState({ kind: 'idle' });
      return;
    }

    const requestId = ++requestRef.current;
    const publish = (next: GitSummaryState) => {
      if (requestId === requestRef.current) {
        setState(next);
      }
    };

    publish({ kind: 'loading' });
    try {
      const response = await api.gitStatus(projectId);
      const body = await response.json() as Record<string, unknown>;
      if (typeof body.error === 'string') {
        // The endpoint answers 200 with an error string for a directory that is
        // simply not a repository, which is a normal state, not a failure.
        publish(/not a git repository/i.test(body.error) ? { kind: 'not-a-repository' } : { kind: 'unavailable' });
        return;
      }
      publish({ kind: 'ready', summary: readSummary(body) });
    } catch {
      publish({ kind: 'unavailable' });
    }
  }, [projectId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void load();
  }, [enabled, load]);

  return { state, refresh: load };
}
