import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import { PROJECTS_QUERY_KEY } from '../../../hooks/useProjectsQuery';
import type { Project } from '../../../types/app';

import MainContentStateView from './MainContentStateView';

/*
 * "Start in a scratch workspace": one click on the empty workspace posts to
 * /api/projects/scratch, refreshes the project list so the sidebar has the
 * row, and opens the new-session flow on that project. A failure stays on
 * the empty state with the server's reason.
 */

afterEach(cleanup);

const i18n = createInstance();
// Only the failure line is translated, so the server's reason is observable;
// every other key renders as itself.
await i18n.init({
  lng: 'en',
  interpolation: { escapeValue: false }, // as src/i18n/config.js: React escapes
  resources: { en: { translation: { mainContent: { scratchFailed: 'failed: {{reason}}' } } } },
});

const scratch: Project = {
  projectId: 'scratch',
  path: '/home/user/gajae-scratch',
  fullPath: '/home/user/gajae-scratch',
  displayName: 'Scratch',
  origin: 'explicit',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Call = { url: string; method: string };

function mount(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const opened: Project[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call = { url, method: init?.method ?? 'GET' };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  client.setQueryData(PROJECTS_QUERY_KEY, []);
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MainContentStateView mode="empty" isMobile={false} onMenuClick={() => {}} onNewSession={(project) => opened.push(project)} />
      </I18nextProvider>
    </QueryClientProvider>
  );
  // The mount's own list refresh is not part of the click; only what follows it is asserted.
  const clicks = () => calls.slice(calls.findIndex((call) => call.method === 'POST'));
  return { clicks, opened, restore: () => { globalThis.fetch = originalFetch; } };
}

test('one click creates the scratch project, refreshes the list and opens a conversation in it', async () => {
  const { clicks, opened, restore } = mount((call) => {
    if (call.url.includes('/api/projects/scratch')) return json({ success: true, data: { project: scratch, outcome: 'created', git: true } });
    return json([scratch]);
  });
  try {
    fireEvent.click(screen.getByTestId('main-start-scratch'));
    await waitFor(() => assert.equal(opened.length, 1));

    assert.deepEqual(clicks().map((call) => `${call.method} ${new URL(call.url, 'http://app').pathname}`), [
      'POST /api/projects/scratch',
      'GET /api/projects',
    ]);
    assert.equal(opened[0].projectId, 'scratch');
    assert.equal(screen.queryByRole('alert'), null);
  } finally {
    restore();
  }
});

test('a server failure keeps the empty state and shows the reason', async () => {
  const { opened, restore } = mount((call) => {
    if (call.url.includes('/api/projects/scratch')) return json({ success: false, error: { code: 'INVALID_PROJECT_PATH', message: 'Invalid project path', details: 'Workspace path must be within the allowed workspace root: /srv' } }, 400);
    return json([]);
  });
  try {
    fireEvent.click(screen.getByTestId('main-start-scratch'));
    const alert = await screen.findByRole('alert');
    assert.equal(alert.textContent, 'failed: Workspace path must be within the allowed workspace root: /srv');
    assert.deepEqual(opened, []);
    assert.equal((screen.getByTestId('main-start-scratch') as HTMLButtonElement).disabled, false, 'the button is usable again');
  } finally {
    restore();
  }
});
