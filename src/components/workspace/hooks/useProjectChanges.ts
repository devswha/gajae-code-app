import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';

export type ProjectChange = {
  path: string;
  oldPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
  additions: number;
  deletions: number;
  patch: string | null;
  binary: boolean;
  tooLarge: boolean;
  patchOmitted: boolean;
};

export type ProjectChanges = {
  branch: string | null;
  hasCommits: boolean;
  files: ProjectChange[];
  /** The list was capped server-side; how many exist in all. */
  totalFiles: number;
  truncated: boolean;
};

export type ProjectChangesState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; changes: ProjectChanges }
  | { kind: 'not-a-repository' }
  | { kind: 'unavailable' };

function readChanges(body: Record<string, unknown>): ProjectChanges {
  const branch = typeof body.branch === 'string' && body.branch.trim() ? body.branch.trim() : null;
  const files = Array.isArray(body.files) ? body.files.flatMap((value): ProjectChange[] => {
    if (!value || typeof value !== 'object') {
      return [];
    }
    const file = value as Record<string, unknown>;
    const status = file.status;
    if (
      typeof file.path !== 'string'
      || !['added', 'modified', 'deleted', 'renamed', 'untracked'].includes(String(status))
    ) {
      return [];
    }
    // The server counts a tracked file's lines with numstat but has no cheap
    // count for an untracked one; its patch is the whole file, countable here.
    const patch = typeof file.patch === 'string' ? file.patch : null;
    const counted = status === 'untracked' && patch
      ? {
          additions: patch.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
          deletions: patch.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).length,
        }
      : {};
    return [{
      path: file.path,
      oldPath: typeof file.oldPath === 'string' ? file.oldPath : null,
      status: status as ProjectChange['status'],
      staged: file.staged === true,
      additions: typeof file.additions === 'number' ? file.additions : 0,
      deletions: typeof file.deletions === 'number' ? file.deletions : 0,
      ...counted,
      patch,
      binary: file.binary === true,
      tooLarge: file.tooLarge === true,
      patchOmitted: file.patchOmitted === true,
    }];
  }) : [];

  return {
    branch,
    hasCommits: body.hasCommits !== false,
    files,
    totalFiles: typeof body.totalFiles === 'number' ? body.totalFiles : files.length,
    truncated: body.truncated === true,
  };
}

export function useProjectChanges(projectId: string | undefined, enabled: boolean, sessionId?: string, executionCwd?: string) {
  const [state, setState] = useState<ProjectChangesState>({ kind: 'idle' });
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!projectId) {
      setState({ kind: 'idle' });
      return;
    }

    const requestId = ++requestRef.current;
    const publish = (next: ProjectChangesState) => {
      if (requestId === requestRef.current) {
        setState(next);
      }
    };

    publish({ kind: 'loading' });
    try {
      const response = await api.get(`/git/diff?project=${encodeURIComponent(projectId)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ''}`);
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok || typeof body.error === 'string') {
        publish(typeof body.error === 'string' && /not a git repository/i.test(body.error) ? { kind: 'not-a-repository' } : { kind: 'unavailable' });
        return;
      }
      publish({ kind: 'ready', changes: readChanges(body) });
    } catch {
      publish({ kind: 'unavailable' });
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void load();
  }, [enabled, load, executionCwd]);

  return { state, refresh: load };
}
