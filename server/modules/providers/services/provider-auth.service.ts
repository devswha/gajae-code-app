import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider, ProviderAuthStatus } from '@/shared/types.js';

async function lookupStatus(providerName: string): Promise<ProviderAuthStatus> {
  return providerRegistry.resolveProvider(providerName).auth.getStatus();
}

export const providerAuthService = {
  async getProviderAuthStatus(providerName: string): Promise<ProviderAuthStatus> {
    return lookupStatus(providerName);
  },

  async isProviderInstalled(providerName: LLMProvider): Promise<boolean> {
    return this.getProviderAuthStatus(providerName)
      .then((status) => status.installed)
      .catch(() => true);
  },
};
