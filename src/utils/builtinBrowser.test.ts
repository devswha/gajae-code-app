import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { builtinBrowserFailure, hasBuiltinBrowserBridge, openBuiltinBrowser } from './builtinBrowser.js';

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

const state = (sessionId: string) => ({
  sessionId,
  activeTabId: 'tab',
  tabs: [{ id: 'tab', title: 'Example', url: 'https://example.com/', loading: false, canGoBack: false, canGoForward: false }],
  binding: { windowEpoch: 'window-1', documentEpoch: 1, origin: 'https://example.com' },
  profileMode: 'persistent',
});

test('builtin browser requires a desktop bridge and sends one authenticated REST open request', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __TAURI__: { core: { invoke: async () => undefined } } } });
  let request: RequestInit | undefined;
  globalThis.fetch = (async (_url, init) => { request = init; return new Response(JSON.stringify(state('project-a'))); }) as typeof fetch;
  assert.equal(hasBuiltinBrowserBridge(), true);
  await openBuiltinBrowser('project-a', 'https://example.com');
  assert.equal(request?.method, 'POST');
  assert.equal(request?.body, JSON.stringify({ url: 'https://example.com' }));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
  await assert.rejects(openBuiltinBrowser('manual'), /macOS desktop app/);
});

test('a successful response must be a canonical state for the requested session', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __TAURI_INTERNALS__: { invoke: async () => undefined } } });
  for (const invalid of [
    { ...state('other-session'), sessionId: 'other-session' },
    { ...state('session-a'), binding: { windowEpoch: 1, documentEpoch: 1, origin: 'https://example.com' } },
    { ...state('session-a'), activeTabId: 'tab', tabs: [] },
  ]) {
    globalThis.fetch = (async () => new Response(JSON.stringify(invalid))) as typeof fetch;
    await assert.rejects(openBuiltinBrowser('session-a'), /builtin_browser_invalid_response/);
  }
});

test('a network failure rejects the built-in launch without retrying through another route', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __TAURI_INTERNALS__: { invoke: async () => undefined } } });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new TypeError('network unavailable');
  }) as typeof fetch;

  await assert.rejects(openBuiltinBrowser('session-a', 'https://example.com'), /network unavailable/);
  assert.equal(calls, 1);

});

test('fixed native failure codes map to stable user-facing categories', () => {
  assert.equal(builtinBrowserFailure(new Error('builtin_browser_in_use')), 'busy');
  assert.equal(builtinBrowserFailure(new Error('browser_busy')), 'busy');
  assert.equal(builtinBrowserFailure(new Error('builtin_browser_unavailable')), 'unavailable');
  assert.equal(builtinBrowserFailure(new Error('invalid_url: unsupported protocol')), 'invalidUrl');
  assert.equal(builtinBrowserFailure(new Error('builtin_browser_stale_document')), 'stale');
  assert.equal(builtinBrowserFailure(new Error('private low-level detail')), 'failed');
});
