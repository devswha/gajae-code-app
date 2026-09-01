import type {
  IProvider as ProviderContract,
  IProviderAuth as ProviderAuth,
  IProviderModels as ProviderModels,
  IProviderSessionSynchronizer as SessionSynchronizer,
  IProviderSessions as ProviderSessions,
  IProviderSkills as ProviderSkills,
} from '@/shared/interfaces.js';
import type { LLMProvider as ProviderId } from '@/shared/types.js';

// Provider implementations expose capability collaborators while keeping their identity immutable.
export abstract class AbstractProvider implements ProviderContract {
  protected constructor(readonly id: ProviderId) {}

  abstract readonly auth: ProviderAuth;
  abstract readonly models: ProviderModels;
  abstract readonly sessions: ProviderSessions;
  abstract readonly sessionSynchronizer: SessionSynchronizer;
  abstract readonly skills: ProviderSkills;
}
