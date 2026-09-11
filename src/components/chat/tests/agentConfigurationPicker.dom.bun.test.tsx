import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import type { ProviderModelOption } from '../../../types/app';
import AgentConfigurationPicker from '../view/AgentConfigurationPicker';

/*
 * The preset list as a browser sees it: lit rows for presets the stored
 * subscriptions can run, dimmed and unselectable rows for the rest. The
 * static renderer cannot open the popup (opening is an effect), so the
 * light state has to be proven here, in a DOM.
 *
 * The grouped catalog lands collapsed, so per-preset rows are reached the
 * way a person reaches them: by filtering. The icon-only trigger carries no
 * label, so preset labels identify their rows unambiguously.
 */

afterEach(cleanup);

const options: ProviderModelOption[] = [
  {
    value: 'default',
    label: 'Current',
    roles: { default: 'openai-codex/gpt-5.6-terra:medium' },
  },
  {
    value: 'profile:codex-eco',
    label: 'Codex Eco',
    group: 'CODEX',
    roles: { default: 'openai-codex/gpt-5.6-terra:low' },
  },
  {
    value: 'profile:claude-opus',
    label: 'Claude Opus',
    group: 'CLAUDE',
    roles: { default: 'anthropic/claude-opus-4-8:medium' },
  },
];

const runnableByCodex: ProviderModelOption[] = [
  { value: 'openai-codex/gpt-5.6-terra:xhigh', label: 'Terra' },
];

const signInHint = 'Sign in to {{provider}} in Settings to use this preset';

async function mountPicker({
  modelOptions,
  availabilityKnown,
}: {
  modelOptions: ProviderModelOption[];
  availabilityKnown: boolean;
}) {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: {
        chat: {
          input: {
            agentConfiguration: { signInRequired: signInHint },
          },
        },
      },
    },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <AgentConfigurationPicker
        value="default"
        options={options}
        modelOptions={modelOptions}
        availabilityKnown={availabilityKnown}
        openTrigger={1}
        iconOnly
        onSelect={() => undefined}
      />
    </I18nextProvider>,
  );
}

const row = (label: string) => screen.getByText(label).closest('button')!;

const lit = (button: HTMLButtonElement) => button.dataset.available === 'true' && !button.disabled;

const searchAllPresets = () => {
  // A single vowel present in every label and selector: all three presets match.
  fireEvent.change(screen.getByLabelText('input.agentConfiguration.search'), { target: { value: 'e' } });
};

test('a group whose presets cannot run is dimmed with the sign-in explanation', async () => {
  await mountPicker({ modelOptions: runnableByCodex, availabilityKnown: true });

  assert.equal(lit(screen.getByText('CODEX').closest('button')!), true);
  const claude = screen.getByTitle(signInHint.replace('{{provider}}', 'Anthropic'));
  assert.equal(claude.dataset.available, 'false');
  assert.match(screen.getByText('CLAUDE').className, /text-muted-foreground\/50/);
});

test('a preset whose models cannot run is dimmed and unselectable', async () => {
  await mountPicker({ modelOptions: runnableByCodex, availabilityKnown: true });
  searchAllPresets();

  assert.equal(lit(row('Current')), true);
  assert.equal(lit(row('Codex Eco')), true);
  const opus = row('Claude Opus');
  assert.equal(opus.disabled, true);
  assert.equal(opus.dataset.available, 'false');
  assert.equal(opus.getAttribute('title'), signInHint.replace('{{provider}}', 'Anthropic'));
});

test('unknown availability keeps every preset lit and selectable', async () => {
  await mountPicker({ modelOptions: [], availabilityKnown: false });
  searchAllPresets();

  for (const label of ['Current', 'Codex Eco', 'Claude Opus']) {
    assert.equal(lit(row(label)), true, `${label} must stay lit while availability is unknown`);
  }
  assert.equal(screen.queryByTitle(signInHint.replace('{{provider}}', 'Anthropic')), null);
});

test('a runtime answer with no models dims every preset', async () => {
  await mountPicker({ modelOptions: [], availabilityKnown: true });
  searchAllPresets();

  for (const label of ['Current', 'Codex Eco', 'Claude Opus']) {
    const preset = row(label);
    assert.equal(preset.disabled, true, `${label} must dim when no subscription can run it`);
    assert.equal(preset.dataset.available, 'false');
  }

  // Regression guard: the ungrouped "Current" preset must name its provider
  // (ChatGPT), not its own label ("Current").
  assert.equal(row('Current').getAttribute('title'), signInHint.replace('{{provider}}', 'ChatGPT'));
});
