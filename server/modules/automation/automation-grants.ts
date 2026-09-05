import { appConfigDb } from '@/modules/database/index.js';

import { safeSessionId } from './browser-protocol.js';

export type AutomationGrantKind = 'origin' | 'application';
export type AutomationGrantScope = 'session' | 'always';

export type AutomationGrant = {
  kind: AutomationGrantKind;
  value: string;
  scope: AutomationGrantScope;
  sessionId?: string;
};

type AutomationGrantFilter = {
  kind?: AutomationGrantKind;
  value?: string;
  scope?: AutomationGrantScope;
  sessionId?: string;
};

export function parseAutomationGrantFilter(value: unknown): AutomationGrantFilter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid automation grant filter.');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['kind', 'value', 'scope', 'sessionId'].includes(key))
      || ('kind' in input && input.kind !== 'origin' && input.kind !== 'application')
      || ('scope' in input && input.scope !== 'always' && input.scope !== 'session')
      || ('value' in input && (typeof input.value !== 'string' || !input.value.trim() || input.value.length > 512))
      || ('sessionId' in input && !safeSessionId(input.sessionId))
      || (input.scope === 'session' && !safeSessionId(input.sessionId))
      || (input.scope === 'always' && 'sessionId' in input)) {
    throw new Error('Invalid automation grant filter.');
  }
  return input as AutomationGrantFilter;
}

type PersistedGrants = {
  version: 1;
  origins: string[];
  applications: string[];
};

const CONFIG_KEY = 'automation.grants.v1';

function normalizedValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 512))].sort();
}

export class AutomationGrantStore {
  private readonly sessionOrigins = new Map<string, Set<string>>();
  private readonly sessionApplications = new Map<string, Set<string>>();

  constructor(private readonly storage: Pick<typeof appConfigDb, 'get' | 'set'> = appConfigDb) {}

  list(sessionId?: string): { version: 1; always: PersistedGrants; session: AutomationGrant[] } {
    const always = this.readPersisted();
    const session: AutomationGrant[] = [];
    if (sessionId) {
      for (const value of this.sessionOrigins.get(sessionId) ?? []) session.push({ kind: 'origin', value, scope: 'session', sessionId });
      for (const value of this.sessionApplications.get(sessionId) ?? []) session.push({ kind: 'application', value, scope: 'session', sessionId });
    }
    return { version: 1, always, session };
  }

  grant(grant: AutomationGrant): void {
    if (grant.scope === 'always') {
      const persisted = this.readPersisted();
      const values = grant.kind === 'origin' ? persisted.origins : persisted.applications;
      if (!values.includes(grant.value)) values.push(grant.value);
      values.sort();
      this.storage.set(CONFIG_KEY, JSON.stringify(persisted));
      return;
    }
    if (!grant.sessionId) throw new Error('Session-scoped grants require a session id.');
    const target = grant.kind === 'origin' ? this.sessionOrigins : this.sessionApplications;
    const values = target.get(grant.sessionId) ?? new Set<string>();
    values.add(grant.value);
    target.set(grant.sessionId, values);
  }

  has(kind: AutomationGrantKind, value: string, sessionId: string): boolean {
    const persisted = this.readPersisted();
    if ((kind === 'origin' ? persisted.origins : persisted.applications).includes(value)) return true;
    const target = kind === 'origin' ? this.sessionOrigins : this.sessionApplications;
    return target.get(sessionId)?.has(value) ?? false;
  }

  revoke(filter: AutomationGrantFilter): void {
    const input = parseAutomationGrantFilter(filter);
    if (!input.kind && !input.value && !input.sessionId && !input.scope) {
      this.sessionOrigins.clear();
      this.sessionApplications.clear();
      this.storage.set(CONFIG_KEY, JSON.stringify({ version: 1, origins: [], applications: [] }));
      return;
    }
    if (input.scope !== 'always' && input.sessionId) {
      const targets = input.kind === 'origin'
        ? [this.sessionOrigins]
        : input.kind === 'application'
          ? [this.sessionApplications]
          : [this.sessionOrigins, this.sessionApplications];
      for (const target of targets) {
        if (input.value) target.get(input.sessionId)?.delete(input.value);
        else target.delete(input.sessionId);
      }
    }
    if (input.scope !== 'session' && !input.sessionId) {
      const persisted = this.readPersisted();
      if (!input.kind || input.kind === 'origin') persisted.origins = input.value ? persisted.origins.filter((value) => value !== input.value) : [];
      if (!input.kind || input.kind === 'application') persisted.applications = input.value ? persisted.applications.filter((value) => value !== input.value) : [];
      this.storage.set(CONFIG_KEY, JSON.stringify(persisted));
    }
  }

  clearSession(sessionId: string): void {
    this.sessionOrigins.delete(sessionId);
    this.sessionApplications.delete(sessionId);
  }

  private readPersisted(): PersistedGrants {
    try {
      const parsed = JSON.parse(this.storage.get(CONFIG_KEY) ?? '{}') as Record<string, unknown>;
      return {
        version: 1,
        origins: normalizedValues(parsed.origins),
        applications: normalizedValues(parsed.applications),
      };
    } catch {
      return { version: 1, origins: [], applications: [] };
    }
  }
}
