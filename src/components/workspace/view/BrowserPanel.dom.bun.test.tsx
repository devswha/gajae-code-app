import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';

import '../../../i18n/config';

import BrowserPanel from './BrowserPanel';

const originalFetch = globalThis.fetch;
const originalSocket = globalThis.WebSocket;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const sockets: TestSocket[] = [];
class TestSocket {
  binaryType = '';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) { sockets.push(this); }
  close() { this.closed = true; this.onclose?.(); }
  state(sessionId: string, title: string) {
    this.onmessage?.({ data: JSON.stringify({ type: 'state', payload: browserState(sessionId, title) }) });
  }
  frame(sessionId: string) {
    const header = new TextEncoder().encode(JSON.stringify({ type: 'frame', sessionId, mimeType: 'image/jpeg' }));
    const packet = new ArrayBuffer(4 + header.length + 4);
    new DataView(packet).setUint32(0, header.length);
    const bytes = new Uint8Array(packet);
    bytes.set(header, 4);
    bytes.set([0xff, 0xd8, 0xff, 0xd9], 4 + header.length);
    this.onmessage?.({ data: packet });
  }
}
const browserState = (sessionId: string, title: string) => ({
  sessionId, activeTabId: 'tab', tabs: [{ id: 'tab', title, url: `http://${sessionId}.localhost/`, loading: false, canGoBack: false, canGoForward: false }],
});
const status = { supported: true, browser: { installed: true, state: 'ready', buildId: 'test' } };

function installFetch(handler?: (url: string, init?: RequestInit) => Promise<Response> | undefined) {
  globalThis.WebSocket = TestSocket as unknown as typeof WebSocket;
  globalThis.fetch = async (url, init) => handler?.(String(url), init)
    ?? new Response(JSON.stringify(String(url).endsWith('/status') ? status : { urls: [] }));
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalSocket;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  sockets.length = 0;
});

test('a late browser command cannot replace the tabs and address of another session', async () => {
  let resolveCommand!: (response: Response) => void;
  installFetch((url) => url.endsWith('/command') ? new Promise((resolve) => { resolveCommand = resolve; }) : undefined);
  const view = render(createElement(BrowserPanel, { sessionId: 'a' }));
  await screen.findByLabelText('Web address');
  act(() => sockets[0].state('a', 'Page A'));
  fireEvent.click(screen.getByLabelText('Reload page'));
  view.rerender(createElement(BrowserPanel, { sessionId: 'b' }));
  await screen.findByLabelText('Web address');
  act(() => sockets.at(-1)!.state('b', 'Page B'));
  await act(async () => { resolveCommand(new Response(JSON.stringify(browserState('a', 'Late A')))); });
  assert.equal((screen.getByLabelText('Web address') as HTMLInputElement).value, 'http://b.localhost/');
  assert.equal(screen.queryByText('Late A'), null);
  assert.ok(screen.getByText('Page B'));
});

test('a status failure is visible and can be retried instead of leaving a permanent spinner', async () => {
  let attempts = 0;
  installFetch((url) => url.endsWith('/status')
    ? Promise.resolve(new Response(JSON.stringify(attempts++ === 0 ? { error: 'Automation unavailable' } : status), { status: attempts === 1 ? 503 : 200 }))
    : undefined);
  render(createElement(BrowserPanel, { sessionId: 'a' }));
  await waitFor(() => assert.match(screen.getByRole('alert').textContent ?? '', /Automation unavailable/));
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  await screen.findByLabelText('Web address');
  assert.equal(attempts, 2);
});

test('the preview reconnects after a dropped socket and cancels retries on unmount', async () => {
  installFetch();
  const view = render(createElement(BrowserPanel, { sessionId: 'a' }));
  await screen.findByLabelText('Web address');
  act(() => { sockets[0].onopen?.(); sockets[0].onclose?.(); });
  await waitFor(() => assert.equal(sockets.length, 2), { timeout: 3_000 });
  act(() => sockets[1].onclose?.());
  view.unmount();
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(sockets.length, 2);
});

function observeFrameUrls() {
  const created: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = (blob) => {
    assert.ok(blob instanceof Blob);
    assert.equal(blob.type, 'image/jpeg');
    assert.equal(blob.size, 4, 'the binary frame packet has been decoded into its image payload');
    const url = `blob:browser-frame-${created.length + 1}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  return { created, revoked };
}

test('switching browser sessions revokes A last binary frame and unmounting revokes B last frame', async () => {
  installFetch();
  const { created, revoked } = observeFrameUrls();
  const view = render(createElement(BrowserPanel, { sessionId: 'a' }));
  await screen.findByLabelText('Web address');
  act(() => sockets[0].frame('a'));
  assert.equal(screen.getByAltText('Chromium live preview').getAttribute('src'), created[0]);
  view.rerender(createElement(BrowserPanel, { sessionId: 'b' }));
  await screen.findByLabelText('Web address');
  assert.deepEqual(revoked, [created[0]], 'keyed unmount must release A without executing another React state updater');
  act(() => { sockets[0].frame('a'); sockets[1].frame('b'); });
  assert.equal(created.length, 2, 'the retired socket cannot allocate another frame URL');
  assert.equal(screen.getByAltText('Chromium live preview').getAttribute('src'), created[1]);
  view.unmount();
  assert.deepEqual(revoked, created);
});

test('frame replacement and final unmount release every binary frame URL exactly once', async () => {
  installFetch();
  const { created, revoked } = observeFrameUrls();
  const view = render(createElement(BrowserPanel, { sessionId: 'a' }));
  await screen.findByLabelText('Web address');
  act(() => { sockets[0].frame('a'); sockets[0].frame('a'); });
  assert.equal(created.length, 2);
  assert.deepEqual(revoked, [created[0]]);
  view.unmount();
  assert.deepEqual(revoked, created, 'the latest frame remains live until cleanup and must then be released');
});
