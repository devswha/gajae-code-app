import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import { markDesktopShell } from '../../../utils/externalLink';

import BrowserPanel from './BrowserPanel';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: {} } }, interpolation: { escapeValue: false } });

afterEach(() => { cleanup(); markDesktopShell(false); });

async function mount(url: string, openStatus = 200) {
  const originalFetch = globalThis.fetch;
  const originalSocket = globalThis.WebSocket;
  const originalOpen = window.open;
  const requests: { url: string; body: unknown }[] = [];
  const opened: string[] = [];
  class Socket {
    static instances: Socket[] = [];
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor() { Socket.instances.push(this); }
    close() {}
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  window.open = ((value: string | URL) => { opened.push(String(value)); return null; }) as typeof window.open;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = String(input);
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (target === '/api/automation/status') return response({ supported: true, browser: { installed: true }, cua: { installed: false } });
    if (target === '/api/automation/local-sites') return response({ urls: [] });
    requests.push({ url: target, body: init?.body ? JSON.parse(String(init.body)) : null });
    return response({ success: openStatus === 200 }, openStatus);
  }) as typeof fetch;
  markDesktopShell(true);
  render(<I18nextProvider i18n={i18n}><BrowserPanel sessionId="browser-test" /></I18nextProvider>);
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'workspace.browser.external' })));
  await act(async () => {
    Socket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'state', payload: {
      sessionId: 'browser-test', activeTabId: 'tab', tabs: [{ id: 'tab', url, title: 'Preview', canGoBack: false, canGoForward: false, loading: false }],
    } }) });
  });
  requests.length = 0;
  return {
    requests, opened,
    restore: () => { cleanup(); globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; window.open = originalOpen; },
  };
}

test('the desktop external-browser button opens a local HTTP preview through the sidecar', async () => {
  const f = await mount('http://localhost:5173/preview');
  try {
    fireEvent.click(screen.getByRole('button', { name: 'workspace.browser.external' }));
    await waitFor(() => assert.ok(f.requests.some(request => request.url === '/api/system/open-browser-url')));
    assert.deepEqual(f.requests.find(request => request.url === '/api/system/open-browser-url')?.body, { url: 'http://localhost:5173/preview' });
    assert.deepEqual(f.opened, []);
  } finally { f.restore(); }
});

test('the external-browser button reports opener failure instead of silently doing nothing', async () => {
  const f = await mount('https://example.test/docs', 500);
  try {
    fireEvent.click(screen.getByRole('button', { name: 'workspace.browser.external' }));
    await waitFor(() => assert.ok(screen.getByText('workspace.browser.error')));
    assert.deepEqual(f.opened, []);
  } finally { f.restore(); }
});
