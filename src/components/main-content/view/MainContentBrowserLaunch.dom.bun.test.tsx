import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';

import { resetPaletteOps, usePaletteOps } from '../../../stores/usePaletteOpsStore';
import englishSettings from '../../../i18n/locales/en/settings.json';
import type { Project, ProjectSession } from '../../../types/app';
import type { MainContentProps } from '../types/types';

import MainContent from './MainContent';

const originalFetch = globalThis.fetch;
const originalWindowOpen = window.open;
const originalConsoleError = console.error;

afterEach(() => {
  cleanup();
  resetPaletteOps();
  globalThis.fetch = originalFetch;
  window.open = originalWindowOpen;
  console.error = originalConsoleError;
  sessionStorage.clear();
  localStorage.clear();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

const project: Project = { projectId: 'project-a', displayName: 'Alpha', fullPath: '/work/alpha' };
const session: ProjectSession = { id: 'session/a', title: 'Current session', provider: 'gjc' };

function props(selectedSession: ProjectSession | null): MainContentProps {
  return {
    selectedProject: project,
    selectedSession,
    activeTab: 'chat',
    setActiveTab: () => undefined,
    ws: null,
    sendMessage: () => undefined,
    isMobile: false,
    onMenuClick: () => undefined,
    isLoading: true,
    onInputFocusChange: () => undefined,
    onSessionProcessing: () => undefined,
    onSessionIdle: () => undefined,
    processingSessions: new Map(),
    onNavigateToSession: () => undefined,
    onNewSession: () => undefined,
    onSessionEstablished: () => undefined,
    onShowSettings: () => undefined,
    newSessionTrigger: 0,
  };
}

test('the registered browser action scopes a desktop launch to the selected session', async () => {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ path, method, ...(body === undefined ? {} : { body }) });
    if (path === '/api/projects?skipSynchronization=1') return new Response('[]');
    if (path.endsWith('/permissions')) {
      return new Response(JSON.stringify({ data: {
        projectId: 'project-a', projectPath: '/work/alpha', mode: 'ask', allowAlways: [], bypassAcknowledged: false, updatedAt: null,
      } }));
    }
    if (path.endsWith('/location')) return new Response(JSON.stringify({ data: { mode: 'direct', cwd: '/work/alpha' } }));
    if (path.startsWith('/api/browser/')) {
      return new Response(JSON.stringify({
        sessionId: 'session/a', activeTabId: 'tab-1',
        tabs: [{ id: 'tab-1', title: 'Example', url: 'https://example.com/', loading: false, canGoBack: false, canGoForward: false }],
        binding: { windowEpoch: 'window-1', documentEpoch: 1, origin: 'https://example.com' }, profileMode: 'persistent',
      }));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: async () => undefined };

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { common: {}, settings: englishSettings } }, defaultNS: 'common' });
  render(createElement(
    I18nextProvider,
    { i18n },
    createElement(QueryClientProvider, { client }, createElement(MainContent, props(session))),
  ));
  usePaletteOps().openBrowser('https://example.com/path');
  await waitFor(() => assert.ok(calls.some((call) => call.path.startsWith('/api/browser/'))));
  assert.deepEqual(calls.filter((call) => call.path.startsWith('/api/browser/')), [{
    path: '/api/browser/session%2Fa/open',
    method: 'POST',
    body: { url: 'https://example.com/path' },
  }]);
  client.clear();
});

test('native launch failures are visible only for the session that made the request', async () => {
  const browserCalls: string[] = [];
  let finishFirst!: (response: Response) => void;
  let browserRequest = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (path === '/api/projects?skipSynchronization=1') return new Response('[]');
    if (path.endsWith('/permissions')) {
      return new Response(JSON.stringify({ data: {
        projectId: 'project-a', projectPath: '/work/alpha', mode: 'ask', allowAlways: [], bypassAcknowledged: false, updatedAt: null,
      } }));
    }
    if (path.endsWith('/location')) return new Response(JSON.stringify({ data: { mode: 'direct', cwd: '/work/alpha' } }));
    if (path.startsWith('/api/browser/')) {
      browserCalls.push(path);
      browserRequest += 1;
      if (browserRequest === 1) return new Promise<Response>((resolve) => { finishFirst = resolve; });
      return new Response(JSON.stringify({ error: 'browser_busy' }), { status: 409 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: async () => undefined };
  let externalOpens = 0;
  window.open = (() => { externalOpens += 1; return null; }) as typeof window.open;

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { common: {}, settings: englishSettings } }, defaultNS: 'common' });
  const view = render(createElement(
    I18nextProvider,
    { i18n },
    createElement(QueryClientProvider, { client }, createElement(MainContent, props(session))),
  ));

  console.error = () => undefined;
  act(() => usePaletteOps().openBrowser('https://first.example'));
  await waitFor(() => assert.deepEqual(browserCalls, ['/api/browser/session%2Fa/open']));
  const nextSession = { ...session, id: 'session-b' };
  view.rerender(createElement(
    I18nextProvider,
    { i18n },
    createElement(QueryClientProvider, { client }, createElement(MainContent, props(nextSession))),
  ));
  await act(async () => {
    finishFirst(new Response(JSON.stringify({ error: 'builtin_browser_unavailable' }), { status: 503 }));
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
  });
  assert.equal(view.queryByRole('alert'), null);

  act(() => usePaletteOps().openBrowser('https://second.example'));
  await waitFor(() => assert.equal(view.getByRole('alert').textContent, englishSettings.automation.builtinBrowser.errors.busy));
  assert.deepEqual(browserCalls, ['/api/browser/session%2Fa/open', '/api/browser/session-b/open']);
  assert.equal(externalOpens, 0);

  client.clear();
});
