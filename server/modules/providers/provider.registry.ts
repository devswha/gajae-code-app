import { GjcProvider } from '@/modules/providers/list/gjc/gjc.provider.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const registeredProviders = new Map<LLMProvider, IProvider>([
  ['gjc', new GjcProvider()],
]);

const unsupportedProvider = (provider: string): never => {
  throw new AppError(`Unsupported provider "${provider}".`, {
    code: 'UNSUPPORTED_PROVIDER',
    statusCode: 400,
  });
};

export const providerRegistry = {
  listProviders(): IProvider[] {
    return Array.from(registeredProviders.values());
  },

  resolveProvider(provider: string): IProvider {
    return registeredProviders.get(provider as LLMProvider) ?? unsupportedProvider(provider);
  },
};
