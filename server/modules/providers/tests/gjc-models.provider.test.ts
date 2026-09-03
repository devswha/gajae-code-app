import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GjcProviderModels } from '@/modules/providers/list/gjc/gjc-models.provider.js';

test('GJC model catalog merges built-in and custom profiles with custom overrides', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-model-profiles-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const agentDir = path.join(homeDir, '.gjc', 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'models.yml'), `profiles:
  codex-medium:
    display_name: My Codex
    model_mapping:
      default: custom/codex
      planner: custom/planner
  personal:
    display_name: Personal
    model_mapping:
      default: custom/default
`, 'utf8');

  const catalog = await new GjcProviderModels(homeDir).getSupportedModels();
  const codex = catalog.OPTIONS.find((option) => option.value === 'profile:codex-medium');

  assert.equal(catalog.DEFAULT, 'default');
  assert.equal(catalog.OPTIONS.some((option) => option.value === 'profile:claude-opus'), true);
  assert.equal(catalog.OPTIONS.some((option) => option.value === 'profile:personal'), true);
  assert.equal(codex?.label, 'My Codex');
  assert.equal(codex?.roles?.default, 'custom/codex');
  assert.equal(catalog.OPTIONS.filter((option) => option.value === 'profile:codex-medium').length, 1);
});

test('a profile-name reference in config.yml resolves Current to real model selectors', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-model-config-ref-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const agentDir = path.join(homeDir, '.gjc', 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'models.yml'), `profiles:
  personal:
    display_name: Personal
    model_mapping:
      default: custom/daily-driver
      planner: custom/planner
`, 'utf8');
  await writeFile(path.join(agentDir, 'config.yml'), `modelProfile:
  default: personal
configSchemaVersion: 1
`, 'utf8');

  const catalog = await new GjcProviderModels(homeDir).getSupportedModels();
  const current = catalog.OPTIONS.find((option) => option.value === 'default');

  // The profile name itself must never surface as a "model".
  assert.equal(current?.roles?.default, 'custom/daily-driver');
  assert.equal(current?.roles?.planner, 'custom/planner');
});

test('a direct selector in config.yml overrides the referenced profile role', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-model-config-mix-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const agentDir = path.join(homeDir, '.gjc', 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'models.yml'), `profiles:
  personal:
    display_name: Personal
    model_mapping:
      default: custom/daily-driver
      critic: custom/critic
`, 'utf8');
  await writeFile(path.join(agentDir, 'config.yml'), `modelProfile:
  default: personal
  critic: custom/override-critic
`, 'utf8');

  const catalog = await new GjcProviderModels(homeDir).getSupportedModels();
  const current = catalog.OPTIONS.find((option) => option.value === 'default');

  assert.equal(current?.roles?.default, 'custom/daily-driver');
  assert.equal(current?.roles?.critic, 'custom/override-critic');
});

test('inline fallback sequences expose their primary selector without YAML brackets', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-model-config-fallbacks-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const agentDir = path.join(homeDir, '.gjc', 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'config.yml'), `modelRoles:
  default: [glm-zcode53/glm-5.3:high, glm-zcode/glm-5.2:high]
task:
  agentModelOverrides:
    planner: ["glm-zcode53/glm-5.3:medium", "glm-zcode/glm-5.2:medium"]
    critic: ['glm-zcode53/glm-5.3:high', 'glm-zcode/glm-5.2:high']
`, 'utf8');
  await writeFile(path.join(agentDir, 'models.yml'), '', 'utf8');

  const catalog = await new GjcProviderModels(homeDir).getSupportedModels();
  const current = catalog.OPTIONS.find((option) => option.value === 'default');

  assert.deepEqual(current?.roles, {
    default: 'glm-zcode53/glm-5.3:high',
    planner: 'glm-zcode53/glm-5.3:medium',
    critic: 'glm-zcode53/glm-5.3:high',
  });
  assert.equal(JSON.stringify(current).includes(']'), false);
});

test('custom profile fallback sequences expose their primary selector', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-model-profile-fallbacks-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const agentDir = path.join(homeDir, '.gjc', 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'models.yml'), `profiles:
  glm-fallback:
    display_name: GLM fallback
    model_mapping:
      default: [glm-zcode53/glm-5.3:high, glm-zcode/glm-5.2:high]
`, 'utf8');

  const catalog = await new GjcProviderModels(homeDir).getSupportedModels();
  const profile = catalog.OPTIONS.find((option) => option.value === 'profile:glm-fallback');

  assert.equal(profile?.roles?.default, 'glm-zcode53/glm-5.3:high');
});

test('every catalog option carries a group so clients can collapse the preset list', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-model-groups-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const agentDir = path.join(homeDir, '.gjc', 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'models.yml'), `profiles:
  personal:
    display_name: Personal
    model_mapping:
      default: custom/default
`, 'utf8');

  const catalog = await new GjcProviderModels(homeDir).getSupportedModels();
  const ungrouped = catalog.OPTIONS.filter((option) => !option.group);

  // Only "Current" stays ungrouped; it is pinned above the collapsed groups.
  assert.deepEqual(ungrouped.map((option) => option.value), ['default']);
  assert.equal(catalog.OPTIONS.find((option) => option.value === 'profile:claude-opus')?.group, 'CLAUDE');
  assert.equal(catalog.OPTIONS.find((option) => option.value === 'profile:codex-eco')?.group, 'CODEX');
  assert.equal(catalog.OPTIONS.find((option) => option.value === 'profile:personal')?.group, 'CUSTOM');

  // A readable picker needs far fewer groups than presets.
  const groups = new Set(catalog.OPTIONS.map((option) => option.group).filter(Boolean));
  assert.ok(groups.size < catalog.OPTIONS.length / 2, 'groups must collapse the catalog meaningfully');
});

test('runtime model metadata carries each model supported reasoning efforts', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-model-efforts-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const agentDir = path.join(homeDir, '.gjc', 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'config.yml'), `modelProfile:
  default: openai-codex/gpt-test
  planner: custom/no-reasoning
`, 'utf8');

  const catalog = await new GjcProviderModels(homeDir, async () => ({
    ok: true,
    result: {
      models: [
        {
          value: 'openai-codex/gpt-test',
          label: 'GPT Test',
          group: 'openai-codex',
          effort: { default: 'high', values: [{ value: 'low' }, { value: 'high' }, { value: 'unsupported' }] },
        },
        {
          value: 'custom/no-reasoning',
          label: 'No reasoning',
          group: 'custom',
          effort: { values: [] },
        },
      ],
    },
  })).getSupportedModels();

  assert.deepEqual(catalog.MODELS, [
    {
      value: 'openai-codex/gpt-test',
      label: 'GPT Test',
      group: 'openai-codex',
      effort: { default: 'high', values: [{ value: 'low' }, { value: 'high' }] },
    },
    {
      value: 'custom/no-reasoning',
      label: 'No reasoning',
      group: 'custom',
      effort: { values: [] },
    },
  ]);
});

test('runtime canonical models map stale preset providers to an active subscription', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-model-subscription-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const agentDir = path.join(homeDir, '.gjc', 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'config.yml'), `modelRoles:
  default: openai-codex/gpt-5.6-sol:medium
`, 'utf8');

  const catalog = await new GjcProviderModels(homeDir, async () => ({
    ok: true,
    result: {
      models: [
        {
          value: 'cursor/gpt-5.6-sol-high',
          label: 'GPT-5.6 Sol',
          group: 'cursor',
          canonicalId: 'gpt-5.6-sol',
          effort: { default: 'high', values: [] },
        },
        {
          value: 'cursor/unreferenced-model',
          label: 'Unreferenced',
          group: 'cursor',
          canonicalId: 'unreferenced-model',
          effort: { values: [] },
        },
      ],
    },
  })).getSupportedModels();

  assert.deepEqual(catalog.MODELS?.map((model) => model.value), ['cursor/gpt-5.6-sol-high']);
  assert.equal(catalog.MODELS?.[0]?.effort?.default, 'high');
});

test('credential database WAL changes invalidate the model catalog revision', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-model-auth-revision-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const agentDir = path.join(homeDir, '.gjc', 'agent');
  await mkdir(agentDir, { recursive: true });
  const configPath = path.join(agentDir, 'config.yml');
  const walPath = path.join(agentDir, 'agent.db-wal');
  await writeFile(configPath, '', 'utf8');
  await writeFile(walPath, '', 'utf8');
  await utimes(configPath, 10, 10);
  await utimes(walPath, 20, 20);

  const models = new GjcProviderModels(homeDir);
  assert.equal(await models.getCatalogRevision(), 20_000);
  await utimes(walPath, 30, 30);
  assert.equal(await models.getCatalogRevision(), 30_000);
});

test('a runtime that answers with no available model reports an empty MODELS; an unreachable one reports none', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-model-availability-'));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const agentDir = path.join(homeDir, '.gjc', 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'config.yml'), 'modelProfile:\n  default: openai-codex/gpt-test\n', 'utf8');

  // Nobody is signed in: the runtime answers, and its answer is "nothing".
  const signedOut = await new GjcProviderModels(homeDir, async () => ({ ok: true, result: { models: [] } })).getSupportedModels();
  assert.deepEqual(signedOut.MODELS, []);
  assert.ok(signedOut.OPTIONS.length > 0, 'the preset catalog still lists what could be chosen');

  // The worker is down: availability is unknown, not "none".
  const unreachable = await new GjcProviderModels(homeDir, async () => { throw new Error('worker unavailable'); }).getSupportedModels();
  assert.equal('MODELS' in unreachable, false);
});
