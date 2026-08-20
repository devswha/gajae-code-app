import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveSessionModelOptions,
  reasoningOptionsForModel,
  resolveDisplayModel,
  stripEffortSuffix,
} from '../view/subcomponents/ModelAndReasoningPicker';
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

test('deriveSessionModelOptions unions role models, dedupes, and groups by provider', () => {
  const groups = deriveSessionModelOptions(catalog);

  assert.deepEqual(groups.map((group) => group.group), ['anthropic', 'custom', 'openai']);
  assert.deepEqual(groups.find((group) => group.group === 'openai')?.models, ['openai/gpt-5.6-sol']);
  assert.deepEqual(groups.find((group) => group.group === 'custom')?.models, ['custom/codex']);
  // Duplicate across roles/presets collapses to a single entry.
  const all = groups.flatMap((group) => group.models);
  assert.equal(new Set(all).size, all.length);
});

test('effort suffixes never leak into the model list: variants collapse to one base id', () => {
  const groups = deriveSessionModelOptions([
    {
      value: 'profile:a',
      label: 'A',
      roles: { default: 'anthropic/claude-fable-5:medium', critic: 'anthropic/claude-fable-5:high' },
    },
    {
      value: 'profile:b',
      label: 'B',
      roles: { default: 'anthropic/claude-fable-5:xhigh', executor: 'openai-codex/gpt-5.6-terra:xhigh' },
    },
  ]);

  assert.deepEqual(groups.find((group) => group.group === 'anthropic')?.models, ['anthropic/claude-fable-5']);
  assert.deepEqual(groups.find((group) => group.group === 'openai-codex')?.models, ['openai-codex/gpt-5.6-terra']);
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
    { value: 'default', label: 'Current', roles: { default: fallback } },
  ]), [{ group: 'glm-zcode53', models: ['glm-zcode53/glm-5.3'] }]);
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
    {
      value: 'profile:mix',
      label: 'Mix',
      roles: {
        default: 'anthropic/claude-opus-5:xhigh',
        planner: 'kimi-code/k3:high',
        executor: 'openai-codex/gpt-5.6-terra:xhigh',
        architect: 'zai/glm-5',
        critic: 'xai/grok-5:high',
      },
    },
    {
      value: 'profile:rest',
      label: 'Rest',
      roles: { default: 'cursor/composer-2', planner: 'alibaba-token-plan/qwen3.7-max' },
    },
  ]);

  assert.deepEqual(
    groups.map((group) => group.group),
    ['openai-codex', 'anthropic', 'kimi-code', 'zai', 'xai', 'alibaba-token-plan', 'cursor'],
  );
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
  const models = deriveSessionModelOptions(referencing).flatMap((group) => group.models);
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
