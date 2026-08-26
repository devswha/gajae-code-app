import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';

import type { SessionActivitySnapshot } from '../../hooks/useSessionProtection';

import { useRunningSessionsSync } from './useRunningSessionsSync';

type SyncCall = readonly SessionActivitySnapshot[];

function Harness({ onSync }: { onSync: (sessions: SyncCall) => void }) {
  useRunningSessionsSync(onSync);
  return null;
}

function renderHarness(onSync: (sessions: SyncCall) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Harness onSync={onSync} />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

async function withFetch(
  fetchImpl: (input: RequestInfo | URL) => Promise<Response>,
  run: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl as typeof globalThis.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
}

test('mount fetches the running sessions and syncs normalized snapshots', async () => {
  const requests: string[] = [];
  const syncCalls: SyncCall[] = [];

  await withFetch(
    async (input) => {
      requests.push(String(input));
      return jsonResponse({
        data: {
          sessions: [
            { sessionId: 'alpha', startedAt: 1000, statusText: 'Working', canInterrupt: true },
            { sessionId: '', startedAt: 2000 },
            { startedAt: 3000 },
            { sessionId: 'beta', statusText: 42, canInterrupt: 'yes' },
          ],
        },
      });
    },
    async () => {
      renderHarness((sessions) => syncCalls.push(sessions));

      await waitFor(() => {
        assert.equal(syncCalls.length >= 1, true);
      });

      assert.equal(requests.length, 1);
      assert.equal(requests[0].includes('/api/providers/sessions/running'), true);

      const synced = syncCalls[0];
      assert.deepEqual(
        synced.map((session) => session.sessionId),
        ['alpha', 'beta'],
      );
      assert.equal(synced[0].startedAt, 1000);
      assert.equal(synced[0].statusText, 'Working');
      assert.equal(synced[0].canInterrupt, true);
      // Non-string statusText and non-boolean canInterrupt are dropped, not coerced.
      assert.equal(synced[1].statusText, undefined);
      assert.equal(synced[1].canInterrupt, undefined);
    },
  );
});

test('a degraded response never reaches the sync callback', async () => {
  const syncCalls: SyncCall[] = [];
  let requestCount = 0;

  await withFetch(
    async () => {
      requestCount += 1;
      return jsonResponse({ error: 'denied' }, false);
    },
    async () => {
      renderHarness((sessions) => syncCalls.push(sessions));

      await waitFor(() => {
        assert.equal(requestCount >= 1, true);
      });

      // Give a rejected query a chance to (incorrectly) propagate.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      assert.equal(syncCalls.length, 0);
    },
  );
});

test('an identical payload on refetch still reaches the sync callback', async () => {
  const syncCalls: SyncCall[] = [];
  const payload = {
    data: { sessions: [{ sessionId: 'alpha', startedAt: 1000 }] },
  };

  await withFetch(
    async () => jsonResponse(payload),
    async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, refetchInterval: false } },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <Harness onSync={(sessions) => syncCalls.push(sessions)} />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        assert.equal(syncCalls.length, 1);
      });

      // Structural sharing keeps `data` referentially identical for an equal
      // payload; the grace-window contract in useSessionProtection still
      // needs every poll delivered, which is why the hook keys on
      // dataUpdatedAt.
      await act(async () => {
        await queryClient.refetchQueries();
      });

      await waitFor(() => {
        assert.equal(syncCalls.length >= 2, true);
      });

      assert.deepEqual(syncCalls[0], syncCalls[1]);
    },
  );
});
