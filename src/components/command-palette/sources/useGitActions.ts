import { useCallback } from 'react';

import { authenticatedFetch } from '../../../utils/api';

function runGitCommand(endpoint: string, payload: Record<string, unknown>) {
  return authenticatedFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) }).then((response) => response.json());
}

export function useGitActions(projectId: string | undefined) {
  const execute = useCallback((endpoint: string, additional?: Record<string, unknown>) => {
    if (!projectId) return Promise.resolve();
    return runGitCommand(endpoint, { project: projectId, ...additional });
  }, [projectId]);

  const fetch = useCallback(() => execute('/api/git/fetch'), [execute]);
  const pull = useCallback(() => execute('/api/git/pull'), [execute]);
  const push = useCallback(() => execute('/api/git/push'), [execute]);
  const checkout = useCallback((branch: string) => execute('/api/git/checkout', { branch }), [execute]);

  return { fetch, pull, push, checkout };
}
