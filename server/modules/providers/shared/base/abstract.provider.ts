import type {
  IProvider,
  IProviderAuth,
  IProviderModels,
  IProviderSkills,
  IProviderSessionSynchronizer,
  IProviderSessions,
} from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';

export abstract class AbstractProvider implements IProvider {
  abstract readonly models: IProviderModels;
  abstract readonly skills: IProviderSkills;
  abstract readonly auth: IProviderAuth;
  abstract readonly sessions: IProviderSessions;
  abstract readonly sessionSynchronizer: IProviderSessionSynchronizer;
  readonly id: LLMProvider;

  protected constructor(providerId: LLMProvider) {
    this.id = providerId;
  }
}
