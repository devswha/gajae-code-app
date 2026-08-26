import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authenticatedFetch } from '../../../utils/api';
import { DEFAULT_BRANCH, RECENT_COMMITS_LIMIT } from '../constants/constants';
import type {
  GitApiErrorResponse,
  GitBranchesResponse,
  GitCommitSummary,
  GitCommitsResponse,
  GitDiffMap,
  GitDiffResponse,
  GitFileWithDiffResponse,
  GitGenerateMessageResponse,
  GitOperationResponse,
  GitPanelController,
  GitRemoteStatus,
  GitStatusResponse,
  UseGitPanelControllerOptions,
} from '../types/types';
import { getAllChangedFiles } from '../utils/gitPanelUtils';

const fetchWithAuth = authenticatedFetch as (url: string, options?: RequestInit) => Promise<Response>;

async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

export function useGitPanelController({
  selectedProject,
  activeView,
  onFileOpen,
}: UseGitPanelControllerOptions): GitPanelController {
  const queryClient = useQueryClient();
  const projectId = selectedProject?.projectId;
  const gitQueryKey = useMemo(() => ['git', projectId] as const, [projectId]);
  const statusKey = useMemo(() => [...gitQueryKey, 'status'] as const, [gitQueryKey]);
  const branchesKey = useMemo(() => [...gitQueryKey, 'branches'] as const, [gitQueryKey]);
  const remoteStatusKey = useMemo(() => [...gitQueryKey, 'remote-status'] as const, [gitQueryKey]);
  const commitsKey = useMemo(() => [...gitQueryKey, 'commits'] as const, [gitQueryKey]);
  const [gitDiff, setGitDiff] = useState<GitDiffMap>({});
  const [currentBranch, setCurrentBranch] = useState('');
  const [commitDiffs, setCommitDiffs] = useState<GitDiffMap>({});
  const [operationError, setOperationError] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: statusKey,
    enabled: Boolean(projectId),
    queryFn: async (): Promise<GitStatusResponse> => {
      try {
        const response = await fetchWithAuth(`/api/git/status?project=${encodeURIComponent(projectId!)}`);
        return await readJson<GitStatusResponse>(response);
      } catch (error) {
        console.error('Error fetching git status:', error);
        return { error: 'Git operation failed', details: String(error) };
      }
    },
  });
  const branchesQuery = useQuery({
    queryKey: branchesKey,
    enabled: Boolean(projectId),
    queryFn: async (): Promise<Required<Pick<GitBranchesResponse, 'branches' | 'localBranches' | 'remoteBranches'>>> => {
      try {
        const response = await fetchWithAuth(`/api/git/branches?project=${encodeURIComponent(projectId!)}`);
        const data = await readJson<GitBranchesResponse>(response);
        if (!data.error && data.branches) {
          return {
            branches: data.branches,
            localBranches: data.localBranches ?? data.branches,
            remoteBranches: data.remoteBranches ?? [],
          };
        }
      } catch (error) {
        console.error('Error fetching branches:', error);
      }
      return { branches: [], localBranches: [], remoteBranches: [] };
    },
  });
  const remoteStatusQuery = useQuery({
    queryKey: remoteStatusKey,
    enabled: Boolean(projectId),
    queryFn: async (): Promise<GitRemoteStatus | null> => {
      try {
        const response = await fetchWithAuth(`/api/git/remote-status?project=${encodeURIComponent(projectId!)}`);
        const data = await readJson<GitRemoteStatus | GitApiErrorResponse>(response);
        return data.error ? null : (data as GitRemoteStatus);
      } catch (error) {
        console.error('Error fetching remote status:', error);
        return null;
      }
    },
  });
  const commitsQuery = useQuery({
    queryKey: commitsKey,
    enabled: Boolean(projectId) && activeView === 'history',
    queryFn: async (): Promise<GitCommitSummary[]> => {
      try {
        const response = await fetchWithAuth(
          `/api/git/commits?project=${encodeURIComponent(projectId!)}&limit=${RECENT_COMMITS_LIMIT}`,
        );
        const data = await readJson<GitCommitsResponse>(response);
        return !data.error && data.commits ? data.commits : [];
      } catch (error) {
        console.error('Error fetching commits:', error);
        return [];
      }
    },
  });

  const invalidateAll = useCallback(() => {
    if (projectId) {
      void queryClient.invalidateQueries({ queryKey: gitQueryKey });
    }
  }, [gitQueryKey, projectId, queryClient]);
  const clearOperationError = useCallback(() => setOperationError(null), []);

  const fetchFileDiff = useCallback(
    async (filePath: string) => {
      if (!projectId) {
        return;
      }

      try {
        const response = await fetchWithAuth(
          `/api/git/diff?project=${encodeURIComponent(projectId)}&file=${encodeURIComponent(filePath)}`,
        );
        const data = await readJson<GitDiffResponse>(response);
        if (!data.error && data.diff) {
          setGitDiff((previous) => ({ ...previous, [filePath]: data.diff as string }));
        }
      } catch (error) {
        console.error('Error fetching file diff:', error);
      }
    },
    [projectId],
  );

  const fetchMutation = useMutation({
    mutationFn: async (mutationProjectId: string) => {
      const response = await fetchWithAuth('/api/git/fetch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: mutationProjectId }),
      });
      return readJson<GitOperationResponse>(response);
    },
  });
  const pullMutation = useMutation({
    mutationFn: async (mutationProjectId: string) => {
      const response = await fetchWithAuth('/api/git/pull', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: mutationProjectId }),
      });
      return readJson<GitOperationResponse>(response);
    },
  });
  const pushMutation = useMutation({
    mutationFn: async (mutationProjectId: string) => {
      const response = await fetchWithAuth('/api/git/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: mutationProjectId }),
      });
      return readJson<GitOperationResponse>(response);
    },
  });
  const publishMutation = useMutation({
    mutationFn: async ({ mutationProjectId, branch }: { mutationProjectId: string; branch: string }) => {
      const response = await fetchWithAuth('/api/git/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: mutationProjectId, branch }),
      });
      return readJson<GitOperationResponse>(response);
    },
  });
  const createBranchMutation = useMutation({
    mutationFn: async ({ mutationProjectId, branch }: { mutationProjectId: string; branch: string }) => {
      const response = await fetchWithAuth('/api/git/create-branch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: mutationProjectId, branch }),
      });
      return readJson<GitOperationResponse>(response);
    },
  });
  const initialCommitMutation = useMutation({
    mutationFn: async (mutationProjectId: string) => {
      const response = await fetchWithAuth('/api/git/initial-commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: mutationProjectId }),
      });
      return readJson<GitOperationResponse>(response);
    },
  });

  const switchBranch = useCallback(async (branchName: string) => {
    if (!projectId) return false;
    try {
      const response = await fetchWithAuth('/api/git/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectId, branch: branchName }),
      });
      const data = await readJson<GitOperationResponse>(response);
      if (!data.success) {
        console.error('Failed to switch branch:', data.error);
        return false;
      }
      setCurrentBranch(branchName);
      invalidateAll();
      return true;
    } catch (error) {
      console.error('Error switching branch:', error);
      return false;
    }
  }, [invalidateAll, projectId]);

  const createBranch = useCallback(async (branchName: string) => {
    const trimmedBranchName = branchName.trim();
    if (!projectId || !trimmedBranchName) return false;
    try {
      const data = await createBranchMutation.mutateAsync({ mutationProjectId: projectId, branch: trimmedBranchName });
      if (!data.success) {
        console.error('Failed to create branch:', data.error);
        return false;
      }
      setCurrentBranch(trimmedBranchName);
      invalidateAll();
      return true;
    } catch (error) {
      console.error('Error creating branch:', error);
      return false;
    }
  }, [createBranchMutation, invalidateAll, projectId]);

  const deleteBranch = useCallback(async (branchName: string) => {
    if (!projectId) return false;
    try {
      const response = await fetchWithAuth('/api/git/delete-branch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectId, branch: branchName }),
      });
      const data = await readJson<GitOperationResponse>(response);
      if (!data.success) {
        setOperationError(data.error ?? 'Delete branch failed');
        return false;
      }
      void queryClient.invalidateQueries({ queryKey: branchesKey });
      return true;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Delete branch failed');
      return false;
    }
  }, [branchesKey, projectId, queryClient]);

  const runRemoteOperation = useCallback(async (
    mutation: { mutateAsync: (mutationProjectId: string) => Promise<GitOperationResponse> },
    fallback: string,
  ) => {
    if (!projectId) return;
    try {
      const data = await mutation.mutateAsync(projectId);
      if (data.success) {
        invalidateAll();
        return;
      }
      setOperationError(data.error ?? fallback);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : fallback);
    }
  }, [invalidateAll, projectId]);

  const handleFetch = useCallback(async () => runRemoteOperation(fetchMutation, 'Fetch failed'), [fetchMutation, runRemoteOperation]);
  const handlePull = useCallback(async () => runRemoteOperation(pullMutation, 'Pull failed'), [pullMutation, runRemoteOperation]);
  const handlePush = useCallback(async () => runRemoteOperation(pushMutation, 'Push failed'), [pushMutation, runRemoteOperation]);
  const handlePublish = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await publishMutation.mutateAsync({ mutationProjectId: projectId, branch: currentBranch });
      if (data.success) {
        invalidateAll();
        return;
      }
      console.error('Publish failed:', data.error);
    } catch (error) {
      console.error('Error publishing branch:', error);
    }
  }, [currentBranch, invalidateAll, projectId, publishMutation]);

  const discardChanges = useCallback(async (filePath: string) => {
    if (!projectId) return;
    try {
      const response = await fetchWithAuth('/api/git/discard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectId, file: filePath }),
      });
      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        void queryClient.invalidateQueries({ queryKey: statusKey });
        return;
      }
      console.error('Discard failed:', data.error);
    } catch (error) {
      console.error('Error discarding changes:', error);
    }
  }, [projectId, queryClient, statusKey]);

  const deleteUntrackedFile = useCallback(async (filePath: string) => {
    if (!projectId) return;
    try {
      const response = await fetchWithAuth('/api/git/delete-untracked', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectId, file: filePath }),
      });
      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        void queryClient.invalidateQueries({ queryKey: statusKey });
        return;
      }
      console.error('Delete failed:', data.error);
    } catch (error) {
      console.error('Error deleting untracked file:', error);
    }
  }, [projectId, queryClient, statusKey]);

  const stageFiles = useCallback(async (files: string[]) => {
    if (!projectId || files.length === 0) return false;
    try {
      const response = await fetchWithAuth('/api/git/stage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectId, files }),
      });
      const data = await readJson<GitOperationResponse>(response);
      if (!data.success) {
        setOperationError(data.error ?? 'Stage failed');
        return false;
      }
      await queryClient.invalidateQueries({ queryKey: statusKey });
      return true;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Stage failed');
      return false;
    }
  }, [projectId, queryClient, statusKey]);

  const unstageFiles = useCallback(async (files: string[]) => {
    if (!projectId || files.length === 0) return false;
    try {
      const response = await fetchWithAuth('/api/git/unstage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectId, files }),
      });
      const data = await readJson<GitOperationResponse>(response);
      if (!data.success) {
        setOperationError(data.error ?? 'Unstage failed');
        return false;
      }
      await queryClient.invalidateQueries({ queryKey: statusKey });
      return true;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Unstage failed');
      return false;
    }
  }, [projectId, queryClient, statusKey]);

  const fetchCommitDiff = useCallback(async (commitHash: string) => {
    if (!projectId) return;
    try {
      const response = await fetchWithAuth(
        `/api/git/commit-diff?project=${encodeURIComponent(projectId)}&commit=${commitHash}`,
      );
      const data = await readJson<GitDiffResponse>(response);
      if (!data.error && data.diff) {
        setCommitDiffs((previous) => ({ ...previous, [commitHash]: data.diff as string }));
      }
    } catch (error) {
      console.error('Error fetching commit diff:', error);
    }
  }, [projectId]);

  const generateCommitMessage = useCallback(async (files: string[]) => {
    if (!projectId || files.length === 0) return null;
    try {
      const response = await authenticatedFetch('/api/git/generate-commit-message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectId, files }),
      });
      const data = await readJson<GitGenerateMessageResponse>(response);
      if (data.message) return data.message;
      console.error('Failed to generate commit message:', data.error);
      return null;
    } catch (error) {
      console.error('Error generating commit message:', error);
      return null;
    }
  }, [projectId]);

  const commitChanges = useCallback(async (message: string, files: string[]) => {
    if (!projectId || !message.trim() || files.length === 0) return false;
    try {
      const response = await fetchWithAuth('/api/git/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectId, message, files }),
      });
      const data = await readJson<GitOperationResponse>(response);
      if (data.success) {
        invalidateAll();
        return true;
      }
      console.error('Commit failed:', data.error);
      return false;
    } catch (error) {
      console.error('Error committing changes:', error);
      return false;
    }
  }, [invalidateAll, projectId]);

  const createInitialCommit = useCallback(async () => {
    if (!projectId) throw new Error('No project selected');
    try {
      const data = await initialCommitMutation.mutateAsync(projectId);
      if (data.success) {
        invalidateAll();
        return true;
      }
      throw new Error(data.error || 'Failed to create initial commit');
    } catch (error) {
      console.error('Error creating initial commit:', error);
      throw error;
    }
  }, [initialCommitMutation, invalidateAll, projectId]);

  const openFile = useCallback(async (filePath: string) => {
    if (!onFileOpen) return;
    if (!projectId) {
      onFileOpen(filePath);
      return;
    }
    try {
      const response = await fetchWithAuth(
        `/api/git/file-with-diff?project=${encodeURIComponent(projectId)}&file=${encodeURIComponent(filePath)}`,
      );
      const data = await readJson<GitFileWithDiffResponse>(response);
      if (data.error) {
        console.error('Error fetching file with diff:', data.error);
        onFileOpen(filePath);
        return;
      }
      onFileOpen(filePath, { old_string: data.oldContent || '', new_string: data.currentContent || '' });
    } catch (error) {
      console.error('Error opening file:', error);
      onFileOpen(filePath);
    }
  }, [onFileOpen, projectId]);

  const refreshAll = useCallback(() => {
    invalidateAll();
  }, [invalidateAll]);

  // Reset repository-scoped local state when the project changes; the
  // query-backed state resets itself through the project-scoped keys.
  useEffect(() => {
    setGitDiff({});
    setCommitDiffs({});
    setCurrentBranch('');
    setOperationError(null);
  }, [projectId]);

  useEffect(() => {
    const data = statusQuery.data;
    if (!data) return;
    setCurrentBranch(data.error ? '' : data.branch || DEFAULT_BRANCH);
  }, [statusQuery.data]);

  useEffect(() => {
    const data = statusQuery.data;
    if (!data || data.error) return;
    getAllChangedFiles(data).forEach((filePath) => { void fetchFileDiff(filePath); });
  }, [fetchFileDiff, statusQuery.data]);

  const gitStatus = statusQuery.data ?? null;
  const branches = branchesQuery.data?.branches ?? [];
  const localBranches = branchesQuery.data?.localBranches ?? [];
  const remoteBranches = branchesQuery.data?.remoteBranches ?? [];
  const recentCommits = commitsQuery.data ?? [];
  const remoteStatus = remoteStatusQuery.data ?? null;

  return {
    gitStatus,
    gitDiff,
    isLoading: statusQuery.isFetching,
    currentBranch,
    branches,
    localBranches,
    remoteBranches,
    recentCommits,
    commitDiffs,
    remoteStatus,
    isCreatingBranch: createBranchMutation.isPending,
    isFetching: fetchMutation.isPending,
    isPulling: pullMutation.isPending,
    isPushing: pushMutation.isPending,
    isPublishing: publishMutation.isPending,
    isCreatingInitialCommit: initialCommitMutation.isPending,
    operationError,
    clearOperationError,
    refreshAll,
    switchBranch,
    createBranch,
    deleteBranch,
    handleFetch,
    handlePull,
    handlePush,
    handlePublish,
    discardChanges,
    deleteUntrackedFile,
    stageFiles,
    unstageFiles,
    fetchCommitDiff,
    generateCommitMessage,
    commitChanges,
    createInitialCommit,
    openFile,
  };
}
