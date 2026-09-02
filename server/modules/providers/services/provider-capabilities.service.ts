import { DEFAULT_GJC_PERMISSION_MODE, GJC_PERMISSION_MODES } from '@/gjc-engine.js';
import type { LLMProvider } from '@/shared/types.js';

type ProviderCapabilities = { provider: LLMProvider; permissionModes: string[]; defaultPermissionMode: string; supportsImages: boolean; supportsAbort: boolean; supportsPermissionRequests: boolean; supportsTokenUsage: boolean; supportsEffort: boolean };

const capabilityList: ProviderCapabilities[] = [{
  provider: 'gjc',
  permissionModes: [...GJC_PERMISSION_MODES],
  defaultPermissionMode: DEFAULT_GJC_PERMISSION_MODE,
  supportsImages: false,
  supportsAbort: true,
  supportsPermissionRequests: true,
  supportsTokenUsage: true,
  supportsEffort: false,
}];

const capabilityByProvider = new Map(capabilityList.map((capability) => [capability.provider, capability]));

export const providerCapabilitiesService = {
  getProviderCapabilities(provider: LLMProvider): ProviderCapabilities {
    return capabilityByProvider.get(provider)!;
  },

  listAllProviderCapabilities(): ProviderCapabilities[] {
    return [...capabilityByProvider.values()];
  },
};
