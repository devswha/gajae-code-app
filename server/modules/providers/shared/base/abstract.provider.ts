import type {
  IProvider,
  IProviderAuth,
  IProviderModels,
  IProviderSkills,
  IProviderSessionSynchronizer,
  IProviderSessions,
} from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * Shared provider base.
 *
 * Concrete providers expose native auth and session handlers.
 */
export abstract class AbstractProvider implements IProvider {
  readonly id: LLMProvider;
  abstract readonly models: IProviderModels;
  abstract readonly skills: IProviderSkills;
  abstract readonly auth: IProviderAuth;
  abstract readonly sessions: IProviderSessions;
  abstract readonly sessionSynchronizer: IProviderSessionSynchronizer;

  protected constructor(id: LLMProvider) {
    this.id = id;
  }
}
