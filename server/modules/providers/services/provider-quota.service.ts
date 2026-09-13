import { loadGjcRuntimeProviderQuota } from '@/shared/utils.js';

import { parseProviderQuotaSnapshot, type ProviderQuotaSnapshot } from '../../../../shared/providerQuota.js';

/**
 * Server-side hold on a quota snapshot.
 *
 * The runtime already caches each credential's usage report for five minutes,
 * so this exists only to keep several browser tabs (or a focus refetch racing
 * a poll) from re-entering the worker for an answer that cannot have changed.
 * It is deliberately shorter than the runtime TTL: it throttles worker round
 * trips, it does not own quota freshness.
 */
const QUOTA_MEMO_MS = 30_000;

type Memo = { snapshot: ProviderQuotaSnapshot; storedAt: number };

let memo: Memo | null = null;
let inFlight: Promise<ProviderQuotaSnapshot> | null = null;

const emptySnapshot = (): ProviderQuotaSnapshot => ({ providers: [], fetchedAt: new Date().toISOString() });

async function readSnapshot(): Promise<ProviderQuotaSnapshot> {
  const payload = await loadGjcRuntimeProviderQuota();
  const response = payload as { ok?: boolean; result?: unknown; error?: { message?: string } } | null;
  if (response && response.ok === false) {
    throw new Error(response.error?.message ?? 'Provider quota is unavailable.');
  }
  const snapshot = parseProviderQuotaSnapshot(response?.result ?? response);
  if (!snapshot) throw new Error('Provider quota response was not usable.');
  return snapshot;
}

export const providerQuotaService = {
  /**
   * Reads the normalized provider quota snapshot. Only the payload-free DTO is
   * ever returned; credentials never leave the worker that owns them.
   */
  async getProviderQuota(options: { refresh?: boolean } = {}): Promise<ProviderQuotaSnapshot> {
    const now = Date.now();
    if (!options.refresh && memo && now - memo.storedAt < QUOTA_MEMO_MS) return memo.snapshot;
    if (inFlight) return inFlight;

    const request = readSnapshot()
      .then((snapshot) => {
        memo = { snapshot, storedAt: Date.now() };
        return snapshot;
      })
      .catch((error: unknown) => {
        // A worker that is not running yet (or a fenced restart) must not turn
        // an ambient status widget into an error banner; the row simply stays
        // empty until the next refresh.
        console.warn('[Providers] Provider quota is unavailable:', error instanceof Error ? error.message : String(error));
        return memo?.snapshot ?? emptySnapshot();
      })
      .finally(() => {
        if (inFlight === request) inFlight = null;
      });

    inFlight = request;
    return request;
  },

  /** Test seam; production state is process-lifetime. */
  resetProviderQuotaCache(): void {
    memo = null;
    inFlight = null;
  },
};
