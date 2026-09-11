import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import english from '../../../../i18n/locales/en/settings.json';

import AutomationSettingsTab from './AutomationSettingsTab';

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

type Call = { path: string; method: string; body?: unknown };

function fakeApi(initialBackend = 'native', accept = true) {
  const calls: Call[] = [];
  let backend = initialBackend;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ path, method, ...(body === undefined ? {} : { body }) });
    if (path === '/api/automation/status') {
      return new Response(JSON.stringify({ supported: true, platform: 'darwin', architecture: 'arm64',
        browser: { installed: false, buildId: 'none', state: 'idle' }, cua: { installed: false, daemon: 'unknown' } }));
    }
    if (path === '/api/automation/grants') return new Response(JSON.stringify({ always: { origins: [], applications: [] } }));
    if (path === '/api/automation/browser-backend') {
      if (method === 'PUT') {
        if (!accept) return new Response(JSON.stringify({ error: 'nope' }), { status: 400 });
        backend = (body as { backend: string }).backend;
      }
      return new Response(JSON.stringify({ backend, backends: ['native', 'aside'] }));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return calls;
}

async function mount() {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { settings: english } }, interpolation: { escapeValue: false } });
  const view = render(<I18nextProvider i18n={i18n}><AutomationSettingsTab /></I18nextProvider>);
  await act(async () => {});
  return view;
}

const select = () => screen.getByRole('combobox', { name: english.automation.browserBackend.label }) as HTMLSelectElement;

test('the browser backend defaults to Native, offers Aside as experimental, and shows no Aside note until chosen', async () => {
  fakeApi();
  await mount();
  await waitFor(() => assert.equal(select().disabled, false));
  assert.equal(select().value, 'native');
  assert.deepEqual([...select().options].map((option) => [option.value, option.textContent]), [
    ['native', 'Native'],
    ['aside', 'Aside (Experimental)'],
  ]);
  assert.ok(screen.getByText(english.automation.browserBackend.nativeDescription));
  assert.equal(screen.queryByText(english.automation.browserBackend.asideNote), null);
});

test('choosing Aside persists through the app API and explains the no-fallback contract; Native restores the default', async () => {
  const calls = fakeApi();
  await mount();
  await waitFor(() => assert.equal(select().disabled, false));

  fireEvent.change(select(), { target: { value: 'aside' } });
  await waitFor(() => assert.equal(select().value, 'aside'));
  assert.deepEqual(calls.filter((call) => call.method === 'PUT'), [
    { path: '/api/automation/browser-backend', method: 'PUT', body: { backend: 'aside' } },
  ]);
  assert.ok(screen.getByText(english.automation.browserBackend.asideDescription));
  assert.ok(screen.getByText(english.automation.browserBackend.asideNote));
  assert.match(english.automation.browserBackend.asideNote, /fails to start instead of falling back/);

  fireEvent.change(select(), { target: { value: 'native' } });
  await waitFor(() => assert.equal(select().value, 'native'));
  assert.equal(screen.queryByText(english.automation.browserBackend.asideNote), null);
  assert.deepEqual(calls.filter((call) => call.method === 'PUT').map((call) => (call.body as { backend: string }).backend), ['aside', 'native']);
});

test('a persisted Aside choice is shown on load, and a rejected save keeps the previous value and reports it', async () => {
  fakeApi('aside', false);
  await mount();
  await waitFor(() => assert.equal(select().value, 'aside'));
  assert.ok(screen.getByText(english.automation.browserBackend.asideNote));

  fireEvent.change(select(), { target: { value: 'native' } });
  await waitFor(() => assert.ok(screen.getByRole('alert')));
  assert.equal(screen.getByRole('alert').textContent, english.automation.browserBackend.saveFailed);
  assert.equal(select().value, 'aside');
});
