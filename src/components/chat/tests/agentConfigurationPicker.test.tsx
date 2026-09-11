import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ProviderModelOption } from '../../../types/app';
import AgentConfigurationPicker, { derivePresetAvailability, presetProviders } from '../view/AgentConfigurationPicker';

const options: ProviderModelOption[] = [
  {
    value: 'default',
    label: 'Current',
    description: 'Use the current GJC role configuration',
    roles: { default: 'openai-codex/gpt-5.6-sol:medium', planner: 'kimi-code/k3:high' },
  },
  {
    value: 'profile:codex-eco',
    label: 'Codex Eco',
    group: 'CODEX',
    description: 'CODEX built-in preset',
    roles: { default: 'openai-codex/gpt-5.6-terra:low' },
  },
  {
    value: 'profile:codex-pro',
    label: 'Codex Pro',
    group: 'CODEX',
    description: 'CODEX built-in preset',
    roles: { default: 'openai-codex/gpt-5.6-terra:high' },
  },
  {
    value: 'profile:claude-opus',
    label: 'Claude Opus',
    group: 'CLAUDE',
    description: 'CLAUDE built-in preset',
    roles: { default: 'anthropic/claude-opus-4-8:medium' },
  },
];

const renderPicker = (value: string) => renderToStaticMarkup(
  createElement(AgentConfigurationPicker, {
    value,
    options,
    openTrigger: 1,
    onSelect: () => undefined,
  }),
);

test('the closed trigger shows only the active preset label', () => {
  // openTrigger drives an effect, which never runs during static render, so
  // this is the collapsed state: no popup content at all.
  const html = renderPicker('profile:codex-eco');

  assert.match(html, /Codex Eco/);
  assert.doesNotMatch(html, /input\.agentConfiguration\.title<\/p>/);
});

test('every preset carries its group so the picker can collapse the catalog', () => {
  // Regression guard for the flat 30+ row list: the server must keep emitting
  // `group`, otherwise every preset falls into the pinned ungrouped section.
  const grouped = options.filter((option) => option.group);
  const ungrouped = options.filter((option) => !option.group);

  assert.equal(ungrouped.length, 1);
  assert.equal(ungrouped[0].value, 'default');
  assert.equal(grouped.length, 3);
  assert.deepEqual([...new Set(grouped.map((option) => option.group))], ['CODEX', 'CLAUDE']);
});

test('picker renders without a roles grid for non-active presets', () => {
  // The old picker printed a five-row role grid for all 34 presets. Only the
  // active preset's grid may appear, so role selectors of other presets must
  // not be in the markup.
  const html = renderPicker('default');

  assert.doesNotMatch(html, /gpt-5\.6-terra/);
  assert.doesNotMatch(html, /claude-opus-4-8/);
});

test('derivePresetAvailability keeps a preset lit while any of its role models is runnable', () => {
  const models: ProviderModelOption[] = [
    { value: 'openai-codex/gpt-5.6-terra:xhigh', label: 'Terra' },
    { value: 'kimi-code/k3', label: 'Kimi' },
  ];

  // Codex presets run on Terra; the CLAUDE preset names nothing runnable.
  const availability = derivePresetAvailability(options, models, true);

  assert.equal(availability.get('default'), true);
  assert.equal(availability.get('profile:codex-eco'), true);
  assert.equal(availability.get('profile:codex-pro'), true);
  assert.equal(availability.get('profile:claude-opus'), false);
});

test('derivePresetAvailability dims nothing while availability is unknown', () => {
  // No MODELS at all (worker unreachable): every preset stays lit.
  const unknown = derivePresetAvailability(options, [], false);
  assert.deepEqual([...unknown.values()], options.map(() => true));

  // The runtime answered with nothing: nobody signed in, everything dims.
  const emptyAnswer = derivePresetAvailability(options, [], true);
  assert.deepEqual([...emptyAnswer.values()], options.map(() => false));
});

test('derivePresetAvailability cannot judge presets that name no model', () => {
  const judged = derivePresetAvailability(
    [
      { value: 'profile:empty', label: 'No roles' },
      { value: 'profile:named', label: 'Profile-name role', roles: { default: 'missing-profile' } },
    ],
    [],
    true,
  );

  assert.equal(judged.get('profile:empty'), true);
  assert.equal(judged.get('profile:named'), true);
});

test('presetProviders lists the distinct providers a preset names, in first-seen order', () => {
  const spanning: ProviderModelOption = {
    value: 'profile:spanning',
    label: 'Spanning',
    roles: {
      default: 'anthropic/claude-opus-4-8:medium',
      planner: 'openai-codex/gpt-5.6-terra:low',
      executor: 'anthropic/claude-sonnet-4-8:high',
    },
  };
  assert.deepEqual(presetProviders(spanning), ['anthropic', 'openai-codex']);

  assert.deepEqual(presetProviders({ value: 'profile:empty', label: 'No roles' }), []);
  assert.deepEqual(
    presetProviders({ value: 'profile:named', label: 'Profile-name role', roles: { default: 'missing-profile' } }),
    [],
  );
});
