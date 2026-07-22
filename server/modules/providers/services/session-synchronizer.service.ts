import { scanStateDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider } from '@/shared/types.js';

type SessionSynchronizeResult = {
  processedByProvider: Record<LLMProvider, number>;
  failures: string[];
};

/**
 * Orchestrates provider-specific session indexers and indexed-session lifecycle operations.
 */
export const sessionSynchronizerService = {
  /**
   * Runs all provider synchronizers and updates scan_state.last_scanned_at.
   */
  async synchronizeSessions(): Promise<SessionSynchronizeResult> {
    const lastScanAt = scanStateDb.getLastScannedAt();
    const scanBoundary = new Date();
    const processedByProvider: Record<LLMProvider, number> = {
      gjc: 0,
    };
    const failures: string[] = [];

    const results = await Promise.allSettled(
      providerRegistry.listProviders().map(async (provider) => ({
        provider: provider.id,
        processed: await provider.sessionSynchronizer.synchronize(lastScanAt ?? undefined),
      }))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        processedByProvider[result.value.provider] = result.value.processed;
        continue;
      }

      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push(reason);
    }

    if (failures.length === 0) {
      scanStateDb.updateLastScannedAt(scanBoundary);
    } else {
      console.warn(
        `[Sessions] Skipping scan_state cursor advance because ${failures.length} provider sync(s) failed.`,
      );
    }

    return {
      processedByProvider,
      failures,
    };
  },

  /**
   * Reconciles one provider without advancing the shared all-provider scan cursor.
   */
  async reconcileProvider(
    provider: LLMProvider,
    signal?: AbortSignal
  ): Promise<{ processed: number; sessionIds: string[] }> {
    const lastScanAt = scanStateDb.getLastScannedAt();
    const resolvedProvider = providerRegistry.resolveProvider(provider);
    if (!resolvedProvider.sessionSynchronizer.reconcile) {
      throw new Error('Provider session reconciliation is unavailable.');
    }
    return resolvedProvider.sessionSynchronizer.reconcile(lastScanAt ?? undefined, signal);
  },

  /**
   * Indexes one provider artifact file without running a full provider rescan.
   */
  async synchronizeProviderFile(
    provider: LLMProvider,
    filePath: string,
    signal?: AbortSignal
  ): Promise<{ provider: LLMProvider; indexed: boolean; sessionId: string | null }> {
    const resolvedProvider = providerRegistry.resolveProvider(provider);
    const sessionId = await resolvedProvider.sessionSynchronizer.synchronizeFile(filePath, signal);
    return {
      provider,
      indexed: Boolean(sessionId),
      sessionId,
    };
  },
};
