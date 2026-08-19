import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
          effort: { values: [{ value: 'low' }, { value: 'high' }, { value: 'unsupported' }] },
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
      effort: { values: [{ value: 'low' }, { value: 'high' }] },
    },
    {
      value: 'custom/no-reasoning',
      label: 'No reasoning',
      group: 'custom',
      effort: { values: [] },
    },
  ]);
});
