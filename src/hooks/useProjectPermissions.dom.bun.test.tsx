import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import { defaultProjectPermissions, projectPermissionsQueryKey, useProjectPermissions } from './useProjectPermissions';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

test('an unreadable project policy is unknown rather than an invented Ask policy', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(() => useProjectPermissions('bypass-project'), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
  });
  await waitFor(() => assert.equal(view.result.current.isLoading, false));
  assert.equal(view.result.current.permissions, null, 'a fetch failure says nothing about the persisted permission mode');
});

test('a failed refresh retains the last confirmed bypass policy', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const policy = { ...defaultProjectPermissions('a'), mode: 'bypass' as const, bypassAcknowledged: true };
  client.setQueryData(projectPermissionsQueryKey('a'), policy);
  const view = renderHook(() => useProjectPermissions('a'), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
  });
  await act(async () => { await client.invalidateQueries({ queryKey: projectPermissionsQueryKey('a') }); });
  assert.deepEqual(view.result.current.permissions, policy);
});
