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
