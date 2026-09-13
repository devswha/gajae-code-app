/**
 * Rendering contract for the sidebar quota row.
 *
 * These assertions are about what a person can actually see: the arc length is
 * the lowest remaining window, a provider that cannot report a quota never
 * draws one, one provider's failure never blanks its peers, and the footer does
 * not gain a section when there is nothing to show.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createInstance, type TFunction } from 'i18next';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { fetchProviderQuota } from '../../../hooks/useProviderQuota';
import type { ProviderQuotaEntry, ProviderQuotaSnapshot } from '../../../../shared/providerQuota';
import english from '../../../i18n/locales/en/sidebar.json';

import SidebarFooter from './SidebarFooter';
import SidebarProviderQuota from './SidebarProviderQuota';

const NOW = Date.UTC(2026, 0, 2, 12, 0, 0);
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const originalFetch = globalThis.fetch;

const i18n = createInstance();
void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['sidebar'],
  defaultNS: 'sidebar',
  resources: { en: { sidebar: english } },
  interpolation: { escapeValue: false },
});
const t = i18n.getFixedT(null, 'sidebar') as unknown as TFunction;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function entry(overrides: Partial<ProviderQuotaEntry> = {}): ProviderQuotaEntry {
  return {
    provider: 'anthropic',
    providerName: 'Claude',
    accounts: 1,
    windows: [
      { id: '5h', label: '5 hour', remainingPercent: 72, resetAt: iso(2 * 3_600_000 + 14 * 60_000) },
      { id: '7d', label: 'Weekly', remainingPercent: 41, resetAt: iso(50 * 3_600_000) },
    ],
    status: 'ok',
    stale: false,
    fetchedAt: iso(0),
    ...overrides,
  };
}

function stubQuota(providers: ProviderQuotaEntry[]) {
  const snapshot: ProviderQuotaSnapshot = { providers, fetchedAt: iso(0) };
  requestedUrls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({ success: true, data: snapshot }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
}

const requestedUrls: string[] = [];

/** Never settles, so the first-fetch state can be observed deterministically. */
function stubPendingQuota() {
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof globalThis.fetch;
}

const providers = (children: ReactNode) => createElement(
  QueryClientProvider,
  { client: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }) },
  createElement(I18nextProvider, { i18n }, children),
);

const renderRow = (collapsed = false) =>
  render(providers(createElement(SidebarProviderQuota, { collapsed, t })));

const row = () => screen.getByLabelText('Provider quota');
/** The provider marks carry their own `role="img"`, so count the rings themselves. */
const rings = () => row().querySelectorAll('[data-testid^="quota-ring-"]');
const arc = (provider: string) => document.querySelector(`[data-testid="quota-arc-${provider}"]`);
const track = (provider: string) => document.querySelector(`[data-testid="quota-track-${provider}"]`);
const remainingOf = (provider: string) => {
  const value = arc(provider)?.getAttribute('data-remaining');
  return value === null || value === undefined ? undefined : Number(value);
};

test('the ring arc is the lowest remaining window, not the first one', async () => {
  stubQuota([entry()]);
  renderRow();

  await waitFor(() => assert.equal(remainingOf('anthropic'), 41));
  const [drawn, circumference] = (arc('anthropic')?.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number);
  assert.ok(drawn !== undefined && circumference !== undefined);
  assert.ok(Math.abs(drawn / circumference - 0.41) < 0.001, 'the arc length itself carries the meaning');
});

test('the compact indicator shows no percentage text', async () => {
  stubQuota([entry()]);
  renderRow();

  await waitFor(() => assert.ok(arc('anthropic')));
  assert.equal(/\d+%/.test(row().textContent ?? ''), false);
});

test('the accessible name still states the quota for assistive technology', async () => {
  stubQuota([entry()]);
  renderRow();

  await waitFor(() => assert.ok(screen.getByLabelText('Claude: 41% of quota left')));
});

test('an unsupported provider draws no arc and never a fabricated percentage', async () => {
  stubQuota([entry({ provider: 'zai', providerName: 'Z.ai', status: 'unsupported', reason: 'usage_unsupported', windows: [] })]);
  renderRow();

  await waitFor(() => assert.ok(screen.getByLabelText('Z.ai')));
  assert.equal(arc('zai'), null, 'an unsupported provider must not draw a quota it does not have');
  assert.ok(
    track('zai')?.getAttribute('stroke-dasharray'),
    'a dashed track separates "no quota reported" from "quota spent", which also draws no arc',
  );
  assert.equal(rings().length, 1, 'the indicator still occupies its slot');
});

test('a spent quota keeps a solid track, so it cannot be read as "no data"', async () => {
  stubQuota([entry({ windows: [{ id: '5h', label: '5 hour', remainingPercent: 0 }] })]);
  renderRow();

  await waitFor(() => assert.ok(track('anthropic')));
  assert.equal(remainingOf('anthropic'), 0, 'zero remaining is a reading, not a missing one');
  assert.equal(track('anthropic')?.getAttribute('stroke-dasharray'), null);
});

test('a provider needing re-authentication is marked, not drawn as low quota', async () => {
  stubQuota([entry({ status: 'reauth', reason: 'reauth_required' })]);
  renderRow();

  await waitFor(() => assert.ok(document.querySelector('[data-testid="quota-reauth-anthropic"]')));
  assert.equal(arc('anthropic'), null, 'reauth must not read as an almost-spent quota');
});

test('a failing provider does not blank the providers that succeeded', async () => {
  stubQuota([
    entry({ status: 'error', reason: 'fetch_failed', windows: [] }),
    entry({ provider: 'openai-codex', providerName: 'Codex', windows: [{ id: '5h', label: '5 hour', remainingPercent: 63 }] }),
  ]);
  renderRow();

  await waitFor(() => assert.equal(remainingOf('openai-codex'), 63));
  assert.equal(arc('anthropic'), null, 'the failed provider shows no arc');
  assert.equal(rings().length, 2, 'both providers keep their slot');
});

test('no connected provider renders no quota section at all', async () => {
  stubQuota([]);
  renderRow();

  await waitFor(() => assert.equal(document.querySelector('svg'), null));
  assert.equal(screen.queryByLabelText('Provider quota'), null, 'an empty row must not reserve footer height');
});

test('the first fetch keeps a fixed-size placeholder so the footer cannot shift', async () => {
  stubPendingQuota();
  renderRow();

  const placeholder = await waitFor(() => {
    const element = document.querySelector('svg');
    assert.ok(element, 'the loading state holds the indicator size');
    return element;
  });
  assert.equal(placeholder.getAttribute('width'), '22');
  assert.equal(placeholder.querySelector('circle')?.getAttribute('stroke-width'), '2');
  assert.equal(placeholder.querySelector('[data-testid^="quota-arc"]'), null, 'loading draws no quota');
  assert.equal(document.querySelector('.animate-spin'), null, 'an ambient indicator must not animate while loading');
});

test('both sidebar states render every connected provider without clipping', async () => {
  const many = ['anthropic', 'openai-codex', 'zai', 'kimi-code', 'google', 'github-copilot']
    .map((provider, index) => entry({
      provider,
      providerName: provider,
      windows: [{ id: '5h', label: '5 hour', remainingPercent: 10 * (index + 1) }],
    }));
  stubQuota(many);

  const expanded = renderRow();
  await waitFor(() => assert.equal(rings().length, 6));
  assert.ok(row().className.includes('overflow-x-auto'), 'a long row scrolls instead of growing the footer');
  expanded.unmount();

  renderRow(true);
  await waitFor(() => assert.equal(rings().length, 6));
  assert.ok(row().className.includes('flex-col'), 'the collapsed rail stacks vertically');
  assert.ok(row().className.includes('overflow-y-auto'));
});

test('the footer still renders standalone, without the server-state provider', () => {
  const markup = renderToStaticMarkup(createElement(
    I18nextProvider,
    { i18n },
    createElement(SidebarFooter, {
      currentVersion: '2.0.0',
      onOpenArchive: () => {},
      onRefresh: () => {},
      isRefreshing: false,
      onShowSettings: () => {},
      t,
    }),
  ));

  assert.ok(markup.includes('Settings'), 'the Settings control is unaffected');
  assert.equal(markup.includes('Provider quota'), false, 'no server-state provider means no quota row');
});

test('the quota request uses the query spelling the backend accepts', async () => {
  stubQuota([entry()]);
  renderRow();
  await waitFor(() => assert.ok(arc('anthropic')));
  assert.deepEqual(requestedUrls, ['/api/providers/quota'], 'the mounted read is unqualified');

  // The backend rejects anything but the literal `true`/`false` spelling, so a
  // refresh sent as `refresh=1` would 400 and leave the rings stale after a
  // sign-in.
  await fetchProviderQuota(true);
  assert.equal(requestedUrls.at(-1), '/api/providers/quota?refresh=true');
});

test('a render without the server-state provider omits the row rather than throwing', () => {
  const markup = renderToStaticMarkup(createElement(
    I18nextProvider,
    { i18n },
    createElement(SidebarProviderQuota, { t }),
  ));

  assert.equal(markup, '');
});
