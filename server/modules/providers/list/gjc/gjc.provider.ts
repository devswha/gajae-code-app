import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { GjcProviderAuth } from '@/modules/providers/list/gjc/gjc-auth.provider.js';
import { GjcProviderModels } from '@/modules/providers/list/gjc/gjc-models.provider.js';
import { GjcProviderSkills } from '@/modules/providers/list/gjc/gjc-skills.provider.js';
import { GjcSessionSynchronizer } from '@/modules/providers/list/gjc/gjc-session-synchronizer.provider.js';
import { GjcSessionsProvider } from '@/modules/providers/list/gjc/gjc-sessions.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderSkills,
  IProviderSessionSynchronizer,
  IProviderSessions,
} from '@/shared/interfaces.js';

export class GjcProvider extends AbstractProvider {
  readonly models: IProviderModels = new GjcProviderModels();
  readonly skills: IProviderSkills = new GjcProviderSkills();
  readonly auth: IProviderAuth = new GjcProviderAuth();
  readonly sessions: IProviderSessions = new GjcSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new GjcSessionSynchronizer();

  constructor() {
    super('gjc');
  }
}
