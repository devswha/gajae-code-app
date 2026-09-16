import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import english from '../../../../i18n/locales/en/settings.json';
import { resetAppShellStore, useAppShellStore } from '../../../../stores/useAppShellStore';
import type { Project } from '../../../../types/app';

import AutomationSettingsTab from './AutomationSettingsTab';

type Call = { path: string; method: string; body?: unknown };
type ApiOptions = {
  backend?: 'builtin' | 'aside' | 'ego';
  egoActivity?: boolean;
  egoFrames?: boolean;
  rejectBackendSave?: boolean;
  browserOpen?: Response | Error;
  browserReady?: boolean;
  grants?: { always: { origins: string[]; applications: string[] } };
};

const originalFetch = globalThis.fetch;
const originalWindowOpen = window.open;
const project: Project = { projectId: 'project-a', displayName: 'Alpha', fullPath: '/work/alpha' };

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.open = originalWindowOpen;
  resetAppShellStore();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

function fakeApi(options: ApiOptions = {}) {
  const calls: Call[] = [];
  let backend = options.backend ?? 'builtin';
  let egoActivity = options.egoActivity ?? false;
  let egoFrames = options.egoFrames ?? false;
  let grants = options.grants ?? { always: { origins: [], applications: [] } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ path, method, ...(body === undefined ? {} : { body }) });
    if (path === '/api/automation/status') {
      return new Response(JSON.stringify({
        supported: true,
        platform: 'darwin',
        architecture: 'arm64',
        capabilities: { browser: options.browserReady ?? true, computer: true },
        browser: {},
        cua: { installed: true, version: '1.2.3', daemon: 'running', accessibility: true, screenRecording: false },
      }));
    }
    if (path === '/api/automation/grants') {
      if (method === 'DELETE') {
        const target = body as { kind: 'origin' | 'application'; value: string };
        grants = { always: {
          origins: grants.always.origins.filter((value) => target.kind !== 'origin' || value !== target.value),
          applications: grants.always.applications.filter((value) => target.kind !== 'application' || value !== target.value),
        } };
      }
      return new Response(JSON.stringify(grants));
    }
    if (path === '/api/automation/browser-backend') {
      if (method === 'PUT') {
        if (options.rejectBackendSave) return new Response(JSON.stringify({ error: 'rejected' }), { status: 400 });
        backend = (body as { backend: 'builtin' | 'aside' | 'ego' }).backend;
      }
      return new Response(JSON.stringify({ backend, backends: ['builtin', 'aside', 'ego'] }));
    }
    if (path === '/api/automation/ego-activity') {
      if (method === 'PUT') {
        const update = body as { enabled?: boolean; frames?: boolean };
        if ('enabled' in update) egoActivity = update.enabled === true;
        if ('frames' in update) egoFrames = update.frames === true;
        return new Response(JSON.stringify({ ...('enabled' in update ? { enabled: egoActivity } : {}), ...('frames' in update ? { frames: egoFrames } : {}) }));
      }
      // Without a session id the route reports the stored opt-ins and observes nothing.
      return new Response(JSON.stringify({
        configured: egoActivity, enabled: egoActivity,
        framesConfigured: egoFrames, frames: egoActivity && egoFrames,
        supported: true, backend, spaces: [],
      }));
    }
    if (path.startsWith('/api/browser/') && method === 'POST') {
      if (options.browserOpen instanceof Error) throw options.browserOpen;
      return options.browserOpen ?? new Response(JSON.stringify({
        sessionId: decodeURIComponent(path.split('/')[3]),
        activeTabId: 'tab-1',
        tabs: [{ id: 'tab-1', title: 'Example', url: 'https://example.com/', loading: false, canGoBack: false, canGoForward: false }],
        binding: { windowEpoch: 'window-1', documentEpoch: 1, origin: 'https://example.com' },
        profileMode: 'persistent',
      }));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return calls;
}

async function mount() {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { settings: english } },
    interpolation: { escapeValue: false },
  });
  return render(<I18nextProvider i18n={i18n}><AutomationSettingsTab /></I18nextProvider>);
}

const backendSelect = () => screen.getByRole('combobox', { name: english.automation.browserBackend.label }) as HTMLSelectElement;

test('Built-in is the default and every backend choice persists through the API', async () => {
  const calls = fakeApi();
  await mount();
  await waitFor(() => assert.equal(backendSelect().disabled, false));

  assert.equal(backendSelect().value, 'builtin');
  assert.deepEqual([...backendSelect().options].map((option) => [option.value, option.textContent]), [
    ['builtin', english.automation.browserBackend.builtin],
    ['aside', english.automation.browserBackend.aside],
    ['ego', english.automation.browserBackend.ego],
  ]);

  fireEvent.change(backendSelect(), { target: { value: 'aside' } });
  await waitFor(() => assert.equal(backendSelect().value, 'aside'));
  assert.ok(screen.getByText(english.automation.browserBackend.asideNote));
  assert.equal(screen.queryByText(english.automation.browserBackend.egoNote), null);

  fireEvent.change(backendSelect(), { target: { value: 'ego' } });
  await waitFor(() => assert.equal(backendSelect().value, 'ego'));
  assert.ok(screen.getByText(english.automation.browserBackend.egoNote));
  assert.ok(screen.getByText(english.automation.browserBackend.egoDescription));
  assert.equal(screen.queryByText(english.automation.browserBackend.asideNote), null);

  fireEvent.change(backendSelect(), { target: { value: 'builtin' } });
  await waitFor(() => assert.equal(backendSelect().value, 'builtin'));
  assert.equal(screen.queryByText(english.automation.browserBackend.asideNote), null);
  assert.equal(screen.queryByText(english.automation.browserBackend.egoNote), null);
  assert.deepEqual(calls.filter((call) => call.method === 'PUT').map((call) => call.body), [
    { backend: 'aside' },
    { backend: 'ego' },
    { backend: 'builtin' },
  ]);
});

test('the browser activity opt-in belongs to ego, is off by default and persists through the API', async () => {
  const calls = fakeApi({ backend: 'builtin' });
  await mount();
  await waitFor(() => assert.equal(backendSelect().disabled, false));

  const activityLabel = english.automation.browserBackend.activity;
  assert.equal(screen.queryByRole('switch', { name: activityLabel }), null, 'the surface exists only for the ego backend');

  fireEvent.change(backendSelect(), { target: { value: 'ego' } });
  const toggle = await screen.findByRole('switch', { name: activityLabel });
  assert.equal(toggle.getAttribute('aria-checked'), 'false', 'rendering a logged-in browser is never on by default');
  assert.ok(screen.getByText(english.automation.browserBackend.activityDescription));

  fireEvent.click(toggle);
  await waitFor(() => assert.equal(screen.getByRole('switch', { name: activityLabel }).getAttribute('aria-checked'), 'true'));
  assert.deepEqual(calls.filter((call) => call.path === '/api/automation/ego-activity' && call.method === 'PUT').map((call) => call.body), [{ enabled: true }]);

  // Reading the opt-in never asks for a session, so Settings observes no browser.
  assert.equal(calls.some((call) => call.path.startsWith('/api/automation/ego-activity?')), false);

  fireEvent.change(backendSelect(), { target: { value: 'builtin' } });
  await waitFor(() => assert.equal(screen.queryByRole('switch', { name: activityLabel }), null));
});

test('the picture is a second switch: off by default and unavailable until activity is on', async () => {
  const calls = fakeApi({ backend: 'ego' });
  await mount();
  const activity = english.automation.browserBackend.activity;
  const frame = english.automation.browserBackend.activityFrame;

  const frameToggle = await screen.findByRole('switch', { name: frame });
  assert.equal(frameToggle.getAttribute('aria-checked'), 'false');
  // Seeing an address is not agreeing to see the page, so the picture cannot be
  // switched on before the surface it lives in.
  assert.equal((frameToggle as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText(english.automation.browserBackend.activityFrameDescription));

  fireEvent.click(screen.getByRole('switch', { name: activity }));
  await waitFor(() => assert.equal((screen.getByRole('switch', { name: frame }) as HTMLButtonElement).disabled, false));

  fireEvent.click(screen.getByRole('switch', { name: frame }));
  await waitFor(() => assert.equal(screen.getByRole('switch', { name: frame }).getAttribute('aria-checked'), 'true'));
  assert.deepEqual(calls.filter((call) => call.method === 'PUT' && call.path === '/api/automation/ego-activity').map((call) => call.body), [
    { enabled: true },
    { frames: true },
  ]);
});

test('a rejected backend save keeps the persisted choice and reports the failure', async () => {
  fakeApi({ backend: 'aside', rejectBackendSave: true });
  await mount();
  await waitFor(() => assert.equal(backendSelect().value, 'aside'));

  fireEvent.change(backendSelect(), { target: { value: 'builtin' } });
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, english.automation.browserBackend.saveFailed));
  assert.equal(backendSelect().value, 'aside');
});

test('plain web hides desktop launch while CUA diagnostics and saved grants remain usable', async () => {
  const calls = fakeApi({ grants: { always: { origins: ['https://example.com'], applications: ['Safari'] } } });
  await mount();
  await waitFor(() => assert.equal(backendSelect().disabled, false));

  assert.equal(screen.queryByRole('button', { name: english.automation.builtinBrowser.open }), null);
  assert.ok(screen.getByText('1.2.3 · running'));
  assert.ok(screen.getByText(`${english.automation.accessibility}: ${english.automation.granted}`));
  assert.ok(screen.getByText(`${english.automation.screenRecording}: ${english.automation.missing}`));
  assert.ok(screen.getByText('https://example.com'));
  assert.ok(screen.getByText('Safari'));

  fireEvent.click(screen.getAllByRole('button', { name: english.automation.revoke })[0]!);
  await waitFor(() => assert.equal(screen.queryByText('https://example.com'), null));
  assert.deepEqual(calls.find((call) => call.method === 'DELETE')?.body, {
    kind: 'origin', value: 'https://example.com', scope: 'always',
  });
});

test('desktop launch uses the selected app session and exposes an API failure without another open request', async () => {
  useAppShellStore.setState({ selectedProject: project, selectedSession: { id: 'session/a' } });
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: async () => undefined };
  let externalOpens = 0;
  window.open = (() => { externalOpens += 1; return null; }) as typeof window.open;
  const calls = fakeApi({ browserOpen: new Response(JSON.stringify({ error: 'builtin_browser_unavailable' }), { status: 503 }) });
  await mount();
  const button = await screen.findByRole('button', { name: english.automation.builtinBrowser.open }) as HTMLButtonElement;

  fireEvent.click(button);
  await waitFor(() => assert.equal(screen.getByRole('status').textContent, english.automation.builtinBrowser.errors.unavailable));
  assert.deepEqual(calls.filter((call) => call.path.startsWith('/api/browser/')), [
    { path: '/api/browser/session%2Fa/open', method: 'POST', body: {} },
  ]);
  assert.equal(externalOpens, 0);
});

test('desktop launch falls back to the selected project scope when no app session was selected', async () => {
  const calls = fakeApi();
  useAppShellStore.setState({ selectedProject: project, selectedSession: null });
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: async () => undefined };
  await mount();

  fireEvent.click(await screen.findByRole('button', { name: english.automation.builtinBrowser.open }));
  await waitFor(() => assert.equal(screen.getByRole('status').textContent, english.automation.builtinBrowser.opened));
  assert.equal(calls.some((call) => call.path === '/api/browser/project-project-a/open'), true);
});

test('switching and deselecting sessions changes Settings launch ownership immediately', async () => {
  const calls = fakeApi();
  useAppShellStore.setState({ selectedProject: project, selectedSession: { id: 'session-a' } });
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: async () => undefined };
  await mount();
  const button = await screen.findByRole('button', { name: english.automation.builtinBrowser.open });

  fireEvent.click(button);
  await waitFor(() => assert.ok(calls.some((call) => call.path === '/api/browser/session-a/open')));
  act(() => useAppShellStore.setState({ selectedSession: { id: 'session-b' } }));
  fireEvent.click(button);
  await waitFor(() => assert.ok(calls.some((call) => call.path === '/api/browser/session-b/open')));
  act(() => useAppShellStore.setState({ selectedSession: null }));
  fireEvent.click(button);
  await waitFor(() => assert.ok(calls.some((call) => call.path === '/api/browser/project-project-a/open')));
});

test('manual built-in launch is independent of the selected agent backend', async () => {
  const calls = fakeApi();
  useAppShellStore.setState({ selectedProject: project, selectedSession: null });
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: async () => undefined };
  await mount();
  await waitFor(() => assert.equal(backendSelect().disabled, false));

  fireEvent.change(backendSelect(), { target: { value: 'ego' } });
  await waitFor(() => assert.equal(backendSelect().value, 'ego'));
  fireEvent.click(await screen.findByRole('button', { name: english.automation.builtinBrowser.open }));
  await waitFor(() => assert.equal(screen.getByRole('status').textContent, english.automation.builtinBrowser.opened));
  assert.deepEqual(calls.filter((call) => call.path.startsWith('/api/browser/')), [
    { path: '/api/browser/project-project-a/open', method: 'POST', body: {} },
  ]);
});

test('desktop bridge keeps launch disabled until the app server reports browser readiness', async () => {
  const calls = fakeApi({ browserReady: false });
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: async () => undefined };
  await mount();
  const button = await screen.findByRole('button', { name: english.automation.builtinBrowser.open }) as HTMLButtonElement;
  await waitFor(() => assert.equal(button.disabled, true));

  fireEvent.click(button);
  assert.equal(calls.some((call) => call.path.startsWith('/api/browser/')), false);
  assert.ok(screen.getByText('1.2.3 · running'));
});

test('browser routing wording keys have parity across all ten settings locales', () => {
  function leaves(value: unknown, path = ''): Record<string, string> {
    if (typeof value === 'string') return { [path]: value };
    assert.ok(value && typeof value === 'object');
    return Object.assign({}, ...Object.entries(value).map(([key, item]) => leaves(item, `${path}.${key}`)));
  }

  const expected = leaves({ browserBackend: english.automation.browserBackend, builtinBrowser: english.automation.builtinBrowser });
  for (const locale of ['en', 'ko', 'de', 'fr', 'it', 'ja', 'ru', 'tr', 'zh-CN', 'zh-TW']) {
    const file = new URL(`../../../../i18n/locales/${locale}/settings.json`, import.meta.url);
    const translated = JSON.parse(readFileSync(file, 'utf8')) as { automation?: unknown };
    const actual = leaves({
      browserBackend: (translated.automation as { browserBackend?: unknown } | undefined)?.browserBackend,
      builtinBrowser: (translated.automation as { builtinBrowser?: unknown } | undefined)?.builtinBrowser,
    });
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), locale);
    for (const [key, text] of Object.entries(actual)) assert.ok(text.trim().length > 0, `${locale}${key}`);
  }
});
