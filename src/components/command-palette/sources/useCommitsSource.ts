import { authenticatedFetch } from '../../../utils/api';

import { useApiSource } from './useApiSource';

export type CommitResult = { hash: string; shortHash: string; message: string; author: string };
type CommitsResponse = { commits?: Array<{ hash: string; message: string; author: string }>; error?: string };

function commitsUrl(projectId: string): string {
  const query = new URLSearchParams();
  query.set('project', projectId);
  query.set('limit', '50');
  return `/api/git/commits?${query}`;
}

export function useCommitsSource(projectId: string | undefined, enabled: boolean) {
  return useApiSource<CommitResult, CommitsResponse>({
    enabled: Boolean(projectId) && enabled,
    deps: [projectId],
    fetcher: (signal) => authenticatedFetch(commitsUrl(projectId!), { signal }),
    parse: ({ commits = [] }) => commits.map(({ hash, message, author }) => ({
      hash,
      shortHash: hash.substring(0, 7),
      message,
      author,
    })),
  });
}
