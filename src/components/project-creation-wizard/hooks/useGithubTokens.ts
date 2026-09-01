import { useEffect, useRef, useState } from 'react';

import { fetchGithubTokenCredentials } from '../data/workspaceApi';
import type { GithubTokenCredential } from '../types';

type UseGithubTokensParams = { shouldLoad: boolean; selectedTokenId: string; onAutoSelectToken: (tokenId: string) => void };

export const useGithubTokens = ({
  shouldLoad,
  selectedTokenId,
  onAutoSelectToken,
}: UseGithubTokensParams) => {
  const [tokens, setTokens] = useState<GithubTokenCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (!shouldLoad || hasLoaded.current) return undefined;

    let isCurrent = true;
    const load = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const availableTokens = await fetchGithubTokenCredentials();
        if (!isCurrent) return;
        hasLoaded.current = true;
        setTokens(availableTokens);
        const firstToken = availableTokens[0];
        if (firstToken && !selectedTokenId) onAutoSelectToken(String(firstToken.id));
      } catch (reason) {
        if (isCurrent) {
          setLoadError(reason instanceof Error ? reason.message : 'Failed to load GitHub tokens');
        }
      } finally {
        if (isCurrent) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      isCurrent = false;
    };
  }, [onAutoSelectToken, selectedTokenId, shouldLoad]);

  const selectedCredential = tokens.find((credential) => String(credential.id) === selectedTokenId);
  const selectedTokenName = selectedCredential?.credential_name ?? null;
  return { tokens, loading, loadError, selectedTokenName };
};
