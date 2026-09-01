import { authenticatedFetch } from '../../../utils/api';

import { useApiSource } from './useApiSource';

export type BranchResult = { name: string };
type BranchesResponse = { localBranches?: string[] };

export function useBranchesSource(projectId: string | undefined, enabled: boolean) {
  const shouldRequest = Boolean(projectId) && enabled;
  return useApiSource<BranchResult, BranchesResponse>({
    enabled: shouldRequest,
    deps: [projectId],
    fetcher: (signal) => {
      const search = new URLSearchParams([['project', projectId!]]);
      return authenticatedFetch(`/api/git/branches?${search}`, { signal });
    },
    parse: (response) => (response.localBranches ?? []).map((branchName) => ({ name: branchName })),
  });
}
