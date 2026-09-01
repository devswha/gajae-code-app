import { useEffect, useRef, useState } from 'react';

import { fetchGithubTokenCredentials } from '../data/workspaceApi';
import type { GithubTokenCredential } from '../types';

type UseGithubTokensParams = {
  shouldLoad: boolean;
  selectedTokenId: string;
  onAutoSelectToken: (tokenId: string) => void;
};

export const useGithubTokens = ({
  shouldLoad,
  selectedTokenId,
  onAutoSelectToken,
}: UseGithubTokensParams) => {
  const [tokens, setTokens] = useState<GithubTokenCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!shouldLoad || loaded.current) {
      return undefined;
    }

    let active = true;
    const requestTokens = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const availableTokens = await fetchGithubTokenCredentials();
        if (!active) {
          return;
        }

        loaded.current = true;
        setTokens(availableTokens);
        if (availableTokens.length && !selectedTokenId) {
          onAutoSelectToken(String(availableTokens[0].id));
        }
      } catch (reason) {
        if (active) {
          setLoadError(reason instanceof Error ? reason.message : 'Failed to load GitHub tokens');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void requestTokens();
    return () => {
      active = false;
    };
  }, [onAutoSelectToken, selectedTokenId, shouldLoad]);

  const selectedTokenName = tokens.find(({ id }) => String(id) === selectedTokenId)?.credential_name || null;
  return { tokens, loading, loadError, selectedTokenName };
};
