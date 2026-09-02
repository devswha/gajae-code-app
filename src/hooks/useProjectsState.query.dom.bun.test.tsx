import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';

import type { ServerEvent } from '../contexts/WebSocketContext';
import type { Project } from '../types/app';
import { resetAppShellStore } from '../stores/useAppShellStore';

import { useProjectsState } from './useProjectsState';

const project = (sessions: Project['sessions'] = []): Project => ({
  projectId: 'project-1',
  path: '/workspace/project',
  fullPath: '/workspace/project',
  displayName: 'Project one',
  origin: 'explicit',
  isStarred: false,
  sessions,
  sessionMeta: { hasMore: false, total: sessions.length },
});

type HookState = ReturnType<typeof useProjectsState>;

type Harness = {
  getState: () => HookState;
  emit: (event: ServerEvent) => void;
  loadingStates: boolean[];
};

const renderHarness = (): Harness => {
  let state: HookState | null = null;
  let listener: ((event: ServerEvent) => void) | null = null;
  const loadingStates: boolean[] = [];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
  });

  const HarnessComponent = () => {
    const hookState = useProjectsState({
      sessionId: null,
      navigate: (() => undefined) as never,
      subscribe: (nextListener) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
      isMobile: false,
      activeSessions: new Map(),
    });
    state = hookState;
    if (loadingStates.at(-1) !== hookState.isLoadingProjects) {
      loadingStates.push(hookState.isLoadingProjects);
    }

    return createElement('output', { 'data-testid': 'projects-state' }, JSON.stringify({
      projectNames: hookState.projects.map((item) => item.displayName),
      isLoadingProjects: hookState.isLoadingProjects,
      sessionIds: hookState.projects.flatMap((item) => item.sessions?.map((session) => session.id) ?? []),
    }));
  };

  render(createElement(QueryClientProvider, { client: queryClient }, createElement(HarnessComponent)));

  return {
    getState: () => {
      assert.ok(state, 'hook state is available after rendering');
      return state;
    },
    emit: (event) => {
      assert.ok(listener, 'websocket listener is registered');
      listener(event);
    },
    loadingStates,
  };
};

const installFetch = (responses: Array<{ status?: number; body: unknown }>) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const response = responses[calls++];
    assert.ok(response, 'unexpected network request');
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  };
  return {
    calls: () => calls,
    urls: () => urls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

afterEach(() => {
  cleanup();
  // The lone project selects itself and is remembered; do not hand that to the next suite.
  localStorage.clear();
  resetAppShellStore();
});

test('mount fetches projects once and exposes initial loading state', async () => {
  const fetch = installFetch([{ body: [project()] }]);
  try {
    const harness = renderHarness();

    await waitFor(() => assert.deepEqual(harness.getState().projects.map((item) => item.displayName), ['Project one']));

    assert.equal(fetch.calls(), 1);
    assert.equal(new URL(fetch.urls()[0], window.location.origin).pathname, '/api/projects');
    assert.deepEqual(harness.loadingStates, [true, false]);
  } finally {
    fetch.restore();
  }
});

test('silent refresh does not return to initial loading state', async () => {
  const fetch = installFetch([{ body: [project()] }, { body: [project()] }]);
  try {
    const harness = renderHarness();
    await waitFor(() => assert.equal(harness.getState().isLoadingProjects, false));

    await act(async () => {
      await harness.getState().refreshProjectsSilently();
    });

    assert.equal(fetch.calls(), 2);
    assert.deepEqual(harness.loadingStates, [true, false]);
  } finally {
    fetch.restore();
  }
});

test('session upserts write directly to the project cache', async () => {
  const fetch = installFetch([{ body: [project()] }]);
  try {
    const harness = renderHarness();
    await waitFor(() => assert.equal(harness.getState().projects.length, 1));

    act(() => {
      harness.emit({
        kind: 'session_upserted',
        sessionId: 'session-ws',
        provider: 'gjc',
        session: { id: 'session-ws', summary: 'From websocket' },
        project: {
          projectId: 'project-1',
          path: '/workspace/project',
          fullPath: '/workspace/project',
          displayName: 'Project one',
          isStarred: false,
        },
        timestamp: new Date().toISOString(),
      } as ServerEvent);
    });

    await waitFor(() => assert.deepEqual(harness.getState().projects[0]?.sessions?.map((session) => session.id), ['session-ws']));
    assert.equal(fetch.calls(), 1);
  } finally {
    fetch.restore();
  }
});

test('optimistic sessions survive a shorter refetch page', async () => {
  const fetch = installFetch([{ body: [project()] }, { body: [project()] }]);
  try {
    const harness = renderHarness();
    await waitFor(() => assert.equal(harness.getState().projects.length, 1));

    act(() => {
      harness.getState().registerOptimisticSession({
        sessionId: 'session-optimistic',
        provider: 'gjc',
        project: project(),
        summary: 'Optimistic',
      });
    });
    await waitFor(() => assert.deepEqual(harness.getState().projects[0]?.sessions?.map((session) => session.id), ['session-optimistic']));

    await act(async () => {
      await harness.getState().refreshProjectsSilently();
    });

    assert.deepEqual(harness.getState().projects[0]?.sessions?.map((session) => session.id), ['session-optimistic']);
  } finally {
    fetch.restore();
  }
});

test('degraded refetches retain the previous project cache', async () => {
  const fetch = installFetch([
    { body: [project()] },
    { status: 401, body: { error: 'Unauthorized' } },
  ]);
  try {
    const harness = renderHarness();
    await waitFor(() => assert.deepEqual(harness.getState().projects.map((item) => item.displayName), ['Project one']));

    await act(async () => {
      await harness.getState().refreshProjectsSilently();
    });

    assert.deepEqual(harness.getState().projects.map((item) => item.displayName), ['Project one']);
    assert.equal(fetch.calls(), 2);
  } finally {
    fetch.restore();
  }
});

test('sidebar shared props contain only navigation dependencies while the hook return keeps shell state', async () => {
  const fetch = installFetch([{ body: [project()] }]);
  try {
    const harness = renderHarness();
    await waitFor(() => assert.equal(harness.getState().projects.length, 1));

    assert.deepEqual(Object.keys(harness.getState().sidebarSharedProps), [
      'activeSessions',
      'onProjectSelect',
      'onSessionSelect',
      'onNewSession',
      'onSessionDelete',
      'onLoadMoreSessions',
      'onProjectDelete',
      'onRefresh',
      'isMobile',
    ]);
    assert.ok('selectedProject' in harness.getState());
    assert.ok('selectedSession' in harness.getState());
  } finally {
    fetch.restore();
  }
});
