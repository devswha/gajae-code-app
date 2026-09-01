import { authenticatedFetch } from '../../../utils/api';

import { useApiSource } from './useApiSource';

export type BranchResult = { name: string };
type BranchesResponse = { localBranches?: string[] };

export function useBranchesSource(projectId: string | undefined, enabled: boolean) {
  const fetchBranches = (signal: AbortSignal) => {
    const parameters = new URLSearchParams();
    parameters.set('project', projectId!);
    return authenticatedFetch(`/api/git/branches?${parameters.toString()}`, { signal });
  };

  return useApiSource<BranchResult, BranchesResponse>({
    enabled: enabled && projectId !== undefined,
    deps: [projectId],
    fetcher: fetchBranches,
    parse: ({ localBranches = [] }) => localBranches.map((name) => ({ name })),
  });
}
