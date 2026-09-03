import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveSessionModelOptions,
  displayedReasoningEffort,
  modelDisplayLabel,
  persistChosenModel,
  providerDisplayLabel,
  reasoningOptionsForModel,
  resolveDisplayModel,
  stripEffortSuffix,
} from '../view/ModelAndReasoningPicker';
import type { ProviderModelOption } from '../../../types/app';

const catalog: ProviderModelOption[] = [
  {
    value: 'default',
    label: 'Current',
    roles: { default: 'openai/gpt-5.6-sol:medium', planner: 'anthropic/claude-opus-4' },
  },
  {
    value: 'profile:codex-medium',
    label: 'My Codex',
    group: 'CODEX',
    roles: { default: 'custom/codex', executor: 'openai/gpt-5.6-sol' },
  },
  { value: 'profile:empty', label: 'No roles' },
];

test('deriveSessionModelOptions groups executable runtime models by provider', () => {
  const groups = deriveSessionModelOptions([
    { value: 'openai/gpt-5.6-sol', label: 'Sol' },
    { value: 'anthropic/claude-opus-4', label: 'Opus' },
    { value: 'custom/codex', label: 'Codex' },
    { value: 'openai/gpt-5.6-sol', label: 'Sol duplicate' },
  ]);

  assert.deepEqual(groups.map((group) => group.group), ['anthropic', 'custom', 'openai']);
  assert.deepEqual(groups.find((group) => group.group === 'openai')?.models, [
    { value: 'openai/gpt-5.6-sol', label: 'Sol', available: true },
  ]);
  assert.deepEqual(groups.find((group) => group.group === 'custom')?.models, [
    { value: 'custom/codex', label: 'Codex', available: true },
  ]);
  // Duplicate across roles/presets collapses to a single entry.
  const all = groups.flatMap((group) => group.models.map((model) => model.value));
  assert.equal(new Set(all).size, all.length);
});

test('a missing runtime catalog falls back to preset roles instead of an empty picker', () => {
  // Backends without MODELS (or a failed worker) must not disable the tab.
  const groups = deriveSessionModelOptions([], catalog);

  const all = groups.flatMap((group) => group.models.map((model) => model.value));
  assert.deepEqual(all.sort(), ['anthropic/claude-opus-4', 'custom/codex', 'openai/gpt-5.6-sol']);
  // Effort suffixes are stripped and labels compact to the bare model id;
  // nothing is dimmed, because availability is unknown, not none.
  assert.deepEqual(groups.find((group) => group.group === 'openai')?.models, [
    { value: 'openai/gpt-5.6-sol', label: 'gpt-5.6-sol', available: true },
  ]);
  assert.ok(groups.every((group) => group.available));
});

test('when the runtime has answered, preset models it did not list are shown dimmed and unselectable', () => {
  const groups = deriveSessionModelOptions(
    [{ value: 'cursor/composer-2.5', label: 'Composer 2.5' }],
    catalog,
    true,
  );

  // The signed-in provider first and available; the rest still listed, but not selectable.
  assert.deepEqual(groups[0], {
    group: 'cursor',
    available: true,
    models: [{ value: 'cursor/composer-2.5', label: 'Composer 2.5', available: true }],
  });
  const openai = groups.find((group) => group.group === 'openai');
  assert.equal(openai?.available, false);
  assert.deepEqual(openai?.models, [{ value: 'openai/gpt-5.6-sol', label: 'gpt-5.6-sol', available: false }]);
  assert.equal(groups.find((group) => group.group === 'anthropic')?.available, false);
});

test('nobody signed in: the runtime answers with nothing and every preset model is dimmed', () => {
  const groups = deriveSessionModelOptions([], catalog, true);
  const all = groups.flatMap((group) => group.models);
  assert.equal(all.length, 3);
  assert.ok(all.every((model) => model.available === false));
  assert.ok(groups.every((group) => group.available === false));
});

test('effort suffixes never leak into runtime model rows', () => {
  const groups = deriveSessionModelOptions([
    {
      value: 'anthropic/claude-fable-5:medium',
      label: 'A',
    },
    {
      value: 'anthropic/claude-fable-5:high',
      label: 'B',
    },
    {
      value: 'openai-codex/gpt-5.6-terra:xhigh',
      label: 'Terra',
    },
  ]);

  assert.deepEqual(groups.find((group) => group.group === 'anthropic')?.models, [
    { value: 'anthropic/claude-fable-5', label: 'A', available: true },
  ]);
  assert.deepEqual(groups.find((group) => group.group === 'openai-codex')?.models, [
    { value: 'openai-codex/gpt-5.6-terra', label: 'Terra', available: true },
  ]);
});

test('stripEffortSuffix removes only trailing known effort levels', () => {
  assert.equal(stripEffortSuffix('anthropic/claude-fable-5:medium'), 'anthropic/claude-fable-5');
  assert.equal(stripEffortSuffix('kimi-code/k3:high'), 'kimi-code/k3');
  assert.equal(stripEffortSuffix('custom/codex'), 'custom/codex');
  // Unknown suffixes are part of the model id, not an effort level.
  assert.equal(stripEffortSuffix('vendor/model:preview'), 'vendor/model:preview');
});

test('legacy fallback sequences cannot leak brackets or secondary models into the picker', () => {
  const fallback = '[glm-zcode53/glm-5.3:high, glm-zcode/glm-5.2:high]';

  assert.equal(stripEffortSuffix(fallback), 'glm-zcode53/glm-5.3');
  assert.equal(resolveDisplayModel('default', undefined, [
    { value: 'default', label: 'Current', roles: { default: fallback } },
  ]), 'glm-zcode53/glm-5.3');
  assert.deepEqual(deriveSessionModelOptions([
    { value: fallback, label: 'Fallback' },
  ]), [{
    group: 'glm-zcode53',
    available: true,
    models: [{ value: 'glm-zcode53/glm-5.3', label: 'Fallback', available: true }],
  }]);
});

test('resolveDisplayModel prefers the live session model over every fallback', () => {
  assert.equal(
    resolveDisplayModel('profile:codex-medium', 'openai/live-model', catalog),
    'openai/live-model',
  );
});

test('resolveDisplayModel shows a raw selection when the session has not reported yet', () => {
  assert.equal(resolveDisplayModel('custom/codex', undefined, catalog), 'custom/codex');
});

test('resolveDisplayModel falls back to the selected preset default role, then Current', () => {
  assert.equal(resolveDisplayModel('profile:codex-medium', undefined, catalog), 'custom/codex');
  // The default role selector carries `:medium`; the display strips it.
  assert.equal(resolveDisplayModel('default', undefined, catalog), 'openai/gpt-5.6-sol');
  // Unknown selection resolves through the Current preset.
  assert.equal(resolveDisplayModel('profile:missing', undefined, catalog), 'openai/gpt-5.6-sol');
});

test('provider groups follow the requested order: codex, claude, kimi, glm, grok, then rest', () => {
  const groups = deriveSessionModelOptions([
    { value: 'anthropic/claude-opus-5:xhigh', label: 'Claude' },
    { value: 'kimi-code/k3:high', label: 'Kimi' },
    { value: 'openai-codex/gpt-5.6-terra:xhigh', label: 'Codex' },
    { value: 'zai/glm-5', label: 'GLM' },
    { value: 'xai/grok-5:high', label: 'Grok' },
    { value: 'cursor/composer-2', label: 'Cursor' },
    { value: 'alibaba-token-plan/qwen3.7-max', label: 'Qwen' },
  ]);

  assert.deepEqual(
    groups.map((group) => group.group),
    ['openai-codex', 'cursor', 'anthropic', 'kimi-code', 'zai', 'xai', 'alibaba-token-plan'],
  );
});

test('model and provider labels hide transport identifiers from the picker', () => {
  const models: ProviderModelOption[] = [
    { value: 'cursor/gpt-5.6-sol-high', label: 'GPT-5.6 Sol' },
  ];

  assert.equal(modelDisplayLabel('cursor/gpt-5.6-sol-high', models), 'GPT-5.6 Sol');
  assert.equal(modelDisplayLabel('custom/raw-id', models), 'raw-id');
  assert.equal(providerDisplayLabel('alibaba-token-plan'), 'Alibaba Coding Plan');
  assert.equal(providerDisplayLabel('custom-provider'), 'Custom Provider');
});

test('resolveDisplayModel strips an effort suffix from the live session report', () => {
  assert.equal(
    resolveDisplayModel('default', 'anthropic/claude-fable-5:high', catalog),
    'anthropic/claude-fable-5',
  );
});

test('a profile-name reference never renders as a model and resolves through the preset', () => {
  const referencing: ProviderModelOption[] = [
    { value: 'default', label: 'Current', roles: { default: 'fable-opus-codex' } },
    {
      value: 'profile:fable-opus-codex',
      label: 'Fable + Opus + Codex',
      roles: { default: 'anthropic/claude-fable-5:medium' },
    },
  ];

  assert.equal(
    resolveDisplayModel('default', undefined, referencing),
    'anthropic/claude-fable-5',
  );
  // The bare profile name is filtered out of the selectable model list.
  const models = deriveSessionModelOptions([]).flatMap((group) => group.models.map((model) => model.value));
  assert.ok(!models.includes('fable-opus-codex'));
  // An unresolvable reference falls back to no display rather than a bogus id.
  assert.equal(
    resolveDisplayModel('default', undefined, [
      { value: 'default', label: 'Current', roles: { default: 'missing-profile' } },
    ]),
    undefined,
  );
});

test('reasoning choices follow the runtime capabilities of the selected model', () => {
  const models: ProviderModelOption[] = [
    {
      value: 'openai-codex/gpt-test',
      label: 'GPT Test',
      effort: { values: [{ value: 'minimal' }, { value: 'low' }, { value: 'high' }] },
    },
    {
      value: 'custom/plain',
      label: 'Plain',
      effort: { values: [] },
    },
  ];

  assert.deepEqual(
    reasoningOptionsForModel('openai-codex/gpt-test', models),
    ['default', 'off', 'minimal', 'low', 'high'],
  );
  assert.deepEqual(reasoningOptionsForModel('custom/plain', models), []);
  assert.deepEqual(reasoningOptionsForModel('missing/model', models), []);
});

test('a fixed-effort subscription model reports its real level instead of Default', () => {
  const models: ProviderModelOption[] = [
    {
      value: 'cursor/gpt-5.6-sol-high',
      label: 'GPT-5.6 Sol',
      effort: { default: 'high', values: [] },
    },
  ];

  assert.equal(displayedReasoningEffort('default', 'cursor/gpt-5.6-sol-high', models), 'high');
  assert.equal(displayedReasoningEffort('off', 'cursor/gpt-5.6-sol-high', models), 'off');
  assert.equal(displayedReasoningEffort('default', 'missing/model', models), 'default');
});

test('choosing a model persists it before the optional reasoning step', async () => {
  const selected: string[] = [];
  await persistChosenModel('openai-codex/gpt-5.6-sol', 'default', (model) => {
    selected.push(model);
  });
  await persistChosenModel('openai-codex/gpt-5.6-sol', 'openai-codex/gpt-5.6-sol', (model) => {
    selected.push(model);
  });

  assert.deepEqual(selected, ['openai-codex/gpt-5.6-sol']);
});
