import { providerRegistry as registry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider as ProviderName, ProviderAuthStatus as AuthStatus } from '@/shared/types.js';

async function statusFor(providerName: string): Promise<AuthStatus> {
  const provider = registry.resolveProvider(providerName);
  return provider.auth.getStatus();
}

export const providerAuthService = {
  getProviderAuthStatus(providerName: string): Promise<AuthStatus> {
    return statusFor(providerName);
  },

  async isProviderInstalled(providerName: ProviderName): Promise<boolean> {
    // An unavailable provider remains installable from the caller's perspective.
    const status = await this.getProviderAuthStatus(providerName).catch(() => null);
    return status === null ? true : status.installed;
  },
};
