import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { cleanup, renderHook, waitFor } from '@testing-library/react';

import type { ProviderModelsDefinition } from '../../../types/app';

import { useChatProviderState } from './useChatProviderState';

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  localStorage.clear();
});

const catalog = (definition: ProviderModelsDefinition) => {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const path = String(url);
    if (path.includes('/api/providers/gjc/models')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          models: definition,
          cache: { expiresAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', source: 'fresh' },
        },
      }));
    }
    return new Response(JSON.stringify({ success: true, data: {} }));
  }) as typeof globalThis.fetch;
};

const presets: ProviderModelsDefinition['OPTIONS'] = [
  { value: 'default', label: 'Current', roles: { default: 'openai-codex/gpt-6-astra' } },
  { value: 'profile:review', label: 'Review' },
];
const models: ProviderModelsDefinition['MODELS'] = [
  { value: 'openai-codex/gpt-6-astra', label: 'Astra', group: 'openai-codex' },
  { value: 'anthropic/claude-opus-5', label: 'Opus 5', group: 'anthropic' },
];

const provider = () => renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));

test('a model picked from the catalog survives the catalog load that follows it', async () => {
  // The composer's model control writes a raw model id, not a preset. Checking
  // the stored choice against the preset list alone discarded it and rewrote
  // the record as `default`, so every reload silently went back to the runtime
  // default model and the next new session pinned nothing.
  localStorage.setItem('gjc-model', 'anthropic/claude-opus-5');
  catalog({ DEFAULT: 'default', OPTIONS: presets, MODELS: models });

  const view = provider();

  await waitFor(() => assert.equal(view.result.current.providerModelCatalog.gjc?.MODELS?.length, 2));
  assert.equal(view.result.current.gjcModel, 'anthropic/claude-opus-5');
  assert.equal(localStorage.getItem('gjc-model'), 'anthropic/claude-opus-5');
});

test('a preset selection is still accepted', async () => {
  localStorage.setItem('gjc-model', 'profile:review');
  catalog({ DEFAULT: 'default', OPTIONS: presets, MODELS: models });

  const view = provider();

  await waitFor(() => assert.equal(view.result.current.providerModelCatalog.gjc?.OPTIONS.length, 2));
  assert.equal(view.result.current.gjcModel, 'profile:review');
});

test('a stored model the catalog no longer offers falls back to the default selection', async () => {
  localStorage.setItem('gjc-model', 'anthropic/retired-model');
  catalog({ DEFAULT: 'default', OPTIONS: presets, MODELS: models });

  const view = provider();

  await waitFor(() => assert.equal(view.result.current.gjcModel, 'default'));
  assert.equal(localStorage.getItem('gjc-model'), 'default');
});

test('a catalog that reports no models at all leaves the stored choice alone', async () => {
  // No MODELS means the runtime could not be reached, and an empty list means
  // no provider is signed in. Neither is a verdict on the chosen model, and
  // discarding it there loses the choice to a transient outage.
  for (const MODELS of [undefined, []]) {
    localStorage.setItem('gjc-model', 'anthropic/claude-opus-5');
    catalog({ DEFAULT: 'default', OPTIONS: presets, ...(MODELS ? { MODELS } : {}) });

    const view = provider();

    await waitFor(() => assert.ok(view.result.current.providerModelCatalog.gjc));
    assert.equal(view.result.current.gjcModel, 'anthropic/claude-opus-5');
    assert.equal(localStorage.getItem('gjc-model'), 'anthropic/claude-opus-5');
    cleanup();
    localStorage.clear();
  }
});
