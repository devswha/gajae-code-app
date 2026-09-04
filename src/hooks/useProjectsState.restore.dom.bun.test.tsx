import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';

import type { Project } from '../types/app';
import { resetAppShellStore } from '../stores/useAppShellStore';

import { useProjectsState } from './useProjectsState';

/*
 * The selected project survives a reload of `/`.
 *
 * `/session/:id` restores its context from the URL, but `/` used to come back
 * to "pick a project" every time. The last selection is remembered and
 * restored when the list has loaded - and only if the project is still in it.
 */

const project = (projectId: string, displayName: string): Project => ({
  projectId,
  path: `/workspace/${projectId}`,
  fullPath: `/workspace/${projectId}`,
  displayName,
  origin: 'explicit',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
});

// Two projects, so the "a lone project selects itself" rule stays out of the way.
const twoProjects = [project('project-1', 'Project one'), project('project-2', 'Project two')];

type HookState = ReturnType<typeof useProjectsState>;

/** One page load: a fresh query cache and shell store, the same localStorage. */
const mountApp = (route: { sessionId?: string | null } = {}) => {
  let state: HookState | null = null;
  let setRouteSessionId: ((sessionId: string | null) => void) | null = null;
  const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } } });
  const Harness = () => {
    const [sessionId, setSessionId] = useState(route.sessionId ?? null);
    setRouteSessionId = setSessionId;
    state = useProjectsState({
      sessionId,
      navigate: (() => undefined) as never,
      subscribe: () => () => undefined,
      isMobile: false,
      activeSessions: new Map(),
    });
    return null;
  };
  const view = render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));
  return {
    getState: () => {
      assert.ok(state, 'hook state is available after rendering');
      return state;
    },
    setRouteSessionId: (sessionId: string | null) => {
      assert.ok(setRouteSessionId, 'route state is available after rendering');
      setRouteSessionId(sessionId);
    },
    reload: () => {
      view.unmount();
      resetAppShellStore();
    },
  };
};

const serveProjects = (projects: Project[]) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(projects), { status: 200 });
  return () => { globalThis.fetch = originalFetch; };
};

// Suites share one window here, so a remembered id from another file must not
// leak into a "first visit".
beforeEach(() => {
  localStorage.clear();
  resetAppShellStore();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetAppShellStore();
});

test('the project selected before a reload is selected again after it', async () => {
  const restore = serveProjects(twoProjects);
  try {
    const first = mountApp();
    await waitFor(() => assert.equal(first.getState().projects.length, 2));
    assert.equal(first.getState().selectedProject, null, 'nothing is chosen for the user on a first visit');

    act(() => { first.getState().handleProjectSelect(twoProjects[1]); });
    assert.equal(first.getState().selectedProject?.projectId, 'project-2');

    first.reload();
    const second = mountApp();
    await waitFor(() => assert.equal(second.getState().selectedProject?.projectId, 'project-2'));
  } finally {
    restore();
  }
});

test('a remembered project that no longer exists is ignored', async () => {
  localStorage.setItem('selectedProjectId', 'project-deleted');
  const restore = serveProjects(twoProjects);
  try {
    const app = mountApp();
    await waitFor(() => assert.equal(app.getState().projects.length, 2));
    // Give the restore effect a turn; a stale id must not select anything.
    await act(async () => { await Promise.resolve(); });
    assert.equal(app.getState().selectedProject, null);
  } finally {
    restore();
  }
});

test('deleting the selected project forgets it, so a reload does not bring it back', async () => {
  // Three, so that two remain and neither selects itself as a lone project.
  const restore = serveProjects([...twoProjects, project('project-3', 'Project three')]);
  try {
    const app = mountApp();
    await waitFor(() => assert.equal(app.getState().projects.length, 3));
    act(() => { app.getState().handleProjectSelect(twoProjects[0]); });
    assert.equal(localStorage.getItem('selectedProjectId'), 'project-1');

    act(() => { app.getState().handleProjectDelete('project-1'); });
    await act(async () => { await Promise.resolve(); });
    assert.equal(localStorage.getItem('selectedProjectId'), null);
    assert.equal(app.getState().selectedProject, null);
  } finally {
    restore();
  }
});

test('a session route restores from the URL and leaves the remembered project alone', async () => {
  localStorage.setItem('selectedProjectId', 'project-2');
  const restore = serveProjects(twoProjects);
  try {
    const app = mountApp({ sessionId: 'session-elsewhere' });
    await waitFor(() => assert.equal(app.getState().projects.length, 2));
    await act(async () => { await Promise.resolve(); });
    assert.equal(app.getState().selectedProject, null, 'the URL owns the context on /session/:id');
  } finally {
    restore();
  }
});

test('returning to the root route clears a session rehydrated before navigation settled', async () => {
  const session = { id: 'session-1', summary: 'Existing work' };
  const projectWithSession = {
    ...project('project-1', 'Project one'),
    sessions: [session],
    sessionMeta: { hasMore: false, total: 1 },
  };
  const restore = serveProjects([projectWithSession, twoProjects[1]]);
  try {
    const app = mountApp({ sessionId: session.id });
    await waitFor(() => assert.equal(app.getState().selectedSession?.id, session.id));

    act(() => { app.getState().handleNewSession(projectWithSession); });
    await waitFor(() => assert.equal(app.getState().selectedSession?.id, session.id));

    act(() => { app.setRouteSessionId(null); });
    await waitFor(() => assert.equal(app.getState().selectedSession, null));
  } finally {
    restore();
  }
});
