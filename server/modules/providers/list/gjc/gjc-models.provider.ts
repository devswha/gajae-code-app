import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GJC_BUILTIN_MODEL_PROFILES } from '@/modules/providers/list/gjc/gjc-builtin-model-profiles.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

export const GJC_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'default', label: 'Default' },
  ],
  DEFAULT: 'default',
};

const PROFILE_ROLES = ['default', 'planner', 'executor', 'architect', 'critic'] as const;
type ProfileRole = typeof PROFILE_ROLES[number];
type RoleMap = Partial<Record<ProfileRole, string>>;

function unquoteYamlScalar(value: string): string {
  const withoutComment = value.replace(/\s+#.*$/, '').trim();
  if ((withoutComment.startsWith('"') && withoutComment.endsWith('"'))
    || (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

function parseConfiguredRoles(source: string): RoleMap {
  const roles: RoleMap = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s+(default|planner|executor|architect|critic):\s*(.+)$/);
    if (match) roles[match[1] as ProfileRole] = unquoteYamlScalar(match[2]);
  }
  return roles;
}

function parseProfiles(source: string): Array<{ name: string; label: string; roles: RoleMap }> {
  const profiles: Array<{ name: string; label: string; roles: RoleMap }> = [];
  let inProfiles = false;
  let current: { name: string; label: string; roles: RoleMap } | null = null;
  let inMapping = false;

  for (const line of source.split(/\r?\n/)) {
    if (/^profiles:\s*$/.test(line)) {
      inProfiles = true;
      continue;
    }
    if (!inProfiles) continue;
    if (/^\S/.test(line) && line.trim()) break;

    const profileMatch = line.match(/^ {2}([^\s:#]+):/);
    if (profileMatch) {
      current = { name: profileMatch[1], label: profileMatch[1], roles: {} };
      profiles.push(current);
      inMapping = false;
      continue;
    }
    if (!current) continue;
    const displayName = line.match(/^ {4}display_name:\s*(.+)$/);
    if (displayName) {
      current.label = unquoteYamlScalar(displayName[1]);
      continue;
    }
    if (/^ {4}model_mapping:\s*$/.test(line)) {
      inMapping = true;
      continue;
    }
    if (inMapping) {
      const role = line.match(/^ {6}(default|planner|executor|architect|critic):\s*(.+)$/);
      if (role) current.roles[role[1] as ProfileRole] = unquoteYamlScalar(role[2]);
      else if (/^ {4}\S/.test(line)) inMapping = false;
    }
  }
  return profiles.filter((profile) => Object.keys(profile.roles).length > 0);
}

/**
 * `config.yml` roles may reference a profile name (e.g. `modelProfile:
 * default: fable-opus-codex`) instead of a `provider/model` selector. Expand
 * such references through the profile map so the "Current" option surfaces
 * real model ids; keep direct selectors as explicit overrides and drop values
 * that are neither.
 */
function resolveConfiguredRoles(
  configured: RoleMap,
  profiles: Map<string, { roles: RoleMap }>,
): RoleMap {
  const resolved: RoleMap = {};
  const referenced = configured.default && !configured.default.includes('/')
    ? profiles.get(configured.default)
    : undefined;
  if (referenced) Object.assign(resolved, referenced.roles);
  for (const [role, value] of Object.entries(configured)) {
    if (value.includes('/')) resolved[role as ProfileRole] = value;
  }
  return resolved;
}

async function getGjcPresetCatalog(homeDir: string): Promise<ProviderModelsDefinition> {
  const agentDir = path.join(homeDir, '.gjc', 'agent');
  const [configSource, modelsSource] = await Promise.all([
    readFile(path.join(agentDir, 'config.yml'), 'utf8').catch(() => ''),
    readFile(path.join(agentDir, 'models.yml'), 'utf8').catch(() => ''),
  ]);
  const configuredRoles = parseConfiguredRoles(configSource);
  const configuredProfiles = parseProfiles(modelsSource);
  const profiles = new Map(GJC_BUILTIN_MODEL_PROFILES.map((profile) => [profile.name, {
    name: profile.name,
    label: profile.label,
    group: profile.group,
    description: `${profile.group} built-in preset`,
    roles: profile.roles,
  }]));

  for (const profile of configuredProfiles) {
    profiles.set(profile.name, {
      ...profile,
      group: 'CUSTOM',
      description: `${Object.keys(profile.roles).length} role custom preset`,
    });
  }

  return {
    OPTIONS: [
      {
        value: 'default',
        label: 'Current',
        description: 'Use the current GJC role configuration',
        roles: resolveConfiguredRoles(configuredRoles, profiles),
      },
      ...[...profiles.values()].map((profile) => ({
        value: `profile:${profile.name}`,
        label: profile.label,
        description: profile.description,
        group: profile.group,
        roles: profile.roles,
      })),
    ],
    DEFAULT: 'default',
  };
}

export class GjcProviderModels implements IProviderModels {
  constructor(private readonly homeDir: string = os.homedir()) {}

  /**
   * The GJC catalog is parsed from `config.yml` and `models.yml` in the agent
   * directory — no network — so editing either one (or the CLI's own /model
   * command doing it) must invalidate the cache immediately rather than after
   * the multi-day TTL.
   */
  async getCatalogRevision(): Promise<number | null> {
    const agentDir = path.join(this.homeDir, '.gjc', 'agent');
    const stamps = await Promise.all(['config.yml', 'models.yml'].map(
      (name) => stat(path.join(agentDir, name)).then((info) => info.mtimeMs).catch(() => 0),
    ));
    const newest = Math.max(...stamps);
    return newest > 0 ? newest : null;
  }

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const catalog = await getGjcPresetCatalog(this.homeDir);
    return catalog.OPTIONS.length > 1 ? catalog : GJC_FALLBACK_MODELS;
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('gjc', input);
  }
}
