import { scanStateDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider } from '@/shared/types.js';

type SessionSynchronizeResult = { processedByProvider: Record<LLMProvider, number>; failures: string[] };
type ProviderScan = { provider: LLMProvider; processed: number };

function failureMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

async function scanProvider(provider: ReturnType<typeof providerRegistry.listProviders>[number], since: Date | undefined): Promise<ProviderScan> {
  return { provider: provider.id, processed: await provider.sessionSynchronizer.synchronize(since) };
}

function scanSummary(results: PromiseSettledResult<ProviderScan>[]): SessionSynchronizeResult {
  const processedByProvider: Record<LLMProvider, number> = { gjc: 0 };
  const failures: string[] = [];
  for (const outcome of results) {
    if (outcome.status === 'fulfilled') processedByProvider[outcome.value.provider] = outcome.value.processed;
    else failures.push(failureMessage(outcome.reason));
  }
  return { processedByProvider, failures };
}

export const sessionSynchronizerService = {
  async synchronizeSessions(): Promise<SessionSynchronizeResult> {
    const since = scanStateDb.getLastScannedAt() ?? undefined;
    const completedAt = new Date();
    const outcomes = await Promise.allSettled(providerRegistry.listProviders().map((provider) => scanProvider(provider, since)));
    const summary = scanSummary(outcomes);
    if (summary.failures.length === 0) {
      scanStateDb.updateLastScannedAt(completedAt);
    } else {
      console.warn(`[Sessions] Skipping scan_state cursor advance because ${summary.failures.length} provider sync(s) failed.`);
    }
    return summary;
  },

  async reconcileProvider(provider: LLMProvider, signal?: AbortSignal): Promise<{ processed: number; sessionIds: string[] }> {
    const synchronizer = providerRegistry.resolveProvider(provider).sessionSynchronizer;
    if (!synchronizer.reconcile) throw new Error('Provider session reconciliation is unavailable.');
    return synchronizer.reconcile(scanStateDb.getLastScannedAt() ?? undefined, signal);
  },

  async synchronizeProviderFile(provider: LLMProvider, filePath: string, signal?: AbortSignal): Promise<{ provider: LLMProvider; indexed: boolean; sessionId: string | null }> {
    const sessionId = await providerRegistry.resolveProvider(provider).sessionSynchronizer.synchronizeFile(filePath, signal);
    return { provider, indexed: Boolean(sessionId), sessionId };
  },
};
