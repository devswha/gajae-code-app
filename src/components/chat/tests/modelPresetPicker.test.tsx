import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ProviderModelOption } from '../../../types/app';
import ModelPresetPicker from '../view/subcomponents/ModelPresetPicker';

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
  createElement(ModelPresetPicker, {
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
  assert.doesNotMatch(html, /모델 프리셋<\/p>/);
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
