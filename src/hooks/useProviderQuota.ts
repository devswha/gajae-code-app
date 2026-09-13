import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from '../utils/api';
import { parseProviderQuotaSnapshot, type ProviderQuotaSnapshot } from '../../shared/providerQuota';

export const PROVIDER_QUOTA_QUERY_KEY = ['provider-quota'] as const;

/**
 * How long a snapshot counts as current. The runtime caches each credential's
 * usage report for five minutes, so refetching more eagerly than this only
 * re-reads the same numbers back through the worker.
 */
const PROVIDER_QUOTA_STALE_MS = 2 * 60_000;
/**
 * Background cadence while the row is mounted. With the runtime's own
 * per-credential TTL this is at most one provider request per five minutes, and
 * TanStack does not run it while the tab is hidden.
 */
const PROVIDER_QUOTA_REFETCH_MS = 5 * 60_000;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export async function fetchProviderQuota(refresh = false): Promise<ProviderQuotaSnapshot> {
  const response = await api.providerQuota({ refresh });
  if (!response.ok) throw new Error(`provider quota request failed: ${response.status}`);
  const payload = (await response.json().catch(() => null)) as unknown;
  const snapshot = parseProviderQuotaSnapshot(asRecord(payload)?.data ?? payload);
  if (!snapshot) throw new Error('provider quota response was not usable');
  return snapshot;
}

/**
 * Forces a fresh read past the server's request memo.
 *
 * Connecting or re-authenticating an account changes both the connected set
 * and the cached reports, and no window-focus event accompanies an in-app
 * dialog closing, so the surface that completes a sign-in says so explicitly.
 */
export function refreshProviderQuota(client: QueryClient): Promise<ProviderQuotaSnapshot> {
  return client.fetchQuery({ queryKey: PROVIDER_QUOTA_QUERY_KEY, queryFn: () => fetchProviderQuota(true) });
}

/**
 * Reads the normalized provider quota snapshot.
 *
 * Refresh triggers: mount, cache staleness, window focus while stale, and the
 * mounted background cadence. Nothing here fetches per render, and concurrent
 * readers share one query.
 */
export function useProviderQuota() {
  const client = useQueryClient();

  const query = useQuery({
    queryKey: PROVIDER_QUOTA_QUERY_KEY,
    queryFn: () => fetchProviderQuota(),
    staleTime: PROVIDER_QUOTA_STALE_MS,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: PROVIDER_QUOTA_REFETCH_MS,
    retry: 1,
  });

  const refresh = useCallback(() => refreshProviderQuota(client), [client]);

  return {
    providers: query.data?.providers ?? [],
    isLoading: query.isPending,
    isFetching: query.isFetching,
    hasFailed: query.isError,
    refresh,
  };
}
