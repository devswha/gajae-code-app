import type { IProvider, IProviderAuth, IProviderModels, IProviderSessionSynchronizer, IProviderSessions, IProviderSkills } from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';

export abstract class AbstractProvider implements IProvider {
  abstract readonly auth: IProviderAuth;
  abstract readonly models: IProviderModels;
  abstract readonly sessionSynchronizer: IProviderSessionSynchronizer;
  abstract readonly sessions: IProviderSessions;
  abstract readonly skills: IProviderSkills;

  protected constructor(readonly id: LLMProvider) {}
}
