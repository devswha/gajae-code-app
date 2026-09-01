import { GjcProvider as GajaeCodeProvider } from '@/modules/providers/list/gjc/gjc.provider.js';
import type { IProvider as Provider } from '@/shared/interfaces.js';
import type { LLMProvider as ProviderName } from '@/shared/types.js';
import { AppError as ApplicationError } from '@/shared/utils.js';

const knownProviders: ReadonlyMap<ProviderName, Provider> = new Map([
  ['gjc', new GajaeCodeProvider()],
]);

function unsupportedProvider(provider: string): never {
  throw new ApplicationError(`Unsupported provider "${provider}".`, {
    code: 'UNSUPPORTED_PROVIDER',
    statusCode: 400,
  });
}

export const providerRegistry = {
  listProviders(): Provider[] {
    return [...knownProviders.values()];
  },

  resolveProvider(provider: string): Provider {
    const resolved = knownProviders.get(provider as ProviderName);
    return resolved ?? unsupportedProvider(provider);
  },
};
