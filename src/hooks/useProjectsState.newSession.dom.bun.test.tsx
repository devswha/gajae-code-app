import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';

import { appShellRoutePaths } from '../components/app/appRoutes';
import { resetAppShellStore } from '../stores/useAppShellStore';
import type { Project, ProjectSession } from '../types/app';

import type { SessionActivity } from './useSessionProtection';
import { useProjectsState } from './useProjectsState';

/*
 * Starting a fresh chat from a session route takes one click.
 *
 * The shell routes '/' and '/session/:sessionId' through the same component,
 * and react-router applies a navigation as a transition: the stale ':sessionId'
 * renders at least once more after `navigate('/')`, and again on every
 * projects-cache write a still-running session pushes in. The URL-restore rule
 * used to take that stale id at face value and put the old session - and its
 * project - back over the selection the click had just made, so the sidebar's
 * "+" on another project looked inert until it was clicked a second time.
 *
 * This suite drives the real router, so the transition timing is the app's own.
 */

const project = (projectId: string, displayName: string, sessions: ProjectSession[] = []): Project => ({
  projectId,
  path: `/workspace/${projectId}`,
  fullPath: `/workspace/${projectId}`,
  displayName,
  origin: 'explicit',
  isStarred: false,
  sessions,
  sessionMeta: { hasMore: false, total: sessions.length },
});

const running: ProjectSession = { id: 'session-running', summary: 'Work in progress' };
const busy: SessionActivity = { statusText: 'Working', canInterrupt: true, startedAt: Date.now(), awaitingInput: false };
// One stable identity: a fresh map per render would only add churn the shell
// does not have.
const activeSessions = new Map([[running.id, busy]]);
const workspace = [
  project('project-1', 'Project one', [running]),
  project('project-2', 'Project two'),
];

type HookState = ReturnType<typeof useProjectsState>;

const mountShell = (entry: string) => {
  let state: HookState | null = null;
  let pathname = entry;
  const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } } });
  const Shell = () => {
    const navigate = useNavigate();
    const { sessionId } = useParams<{ sessionId?: string }>();
    pathname = useLocation().pathname;
    state = useProjectsState({
      sessionId,
      navigate,
      subscribe: () => () => undefined,
      isMobile: false,
      activeSessions,
    });
    return null;
  };
  render(createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(
      MemoryRouter,
      { initialEntries: [entry] },
      createElement(Routes, null, ...appShellRoutePaths.map((path) => createElement(Route, { key: path, path, element: createElement(Shell) }))),
    ),
  ));
  return {
    getState: () => {
      assert.ok(state, 'hook state is available after rendering');
      return state;
    },
    getPathname: () => pathname,
  };
};

const serveProjects = (projects: Project[]) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(projects), { status: 200 });
  return () => { globalThis.fetch = originalFetch; };
};

beforeEach(() => {
  localStorage.clear();
  resetAppShellStore();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetAppShellStore();
});

test('one "+" click on another project opens its fresh chat and leaves the running session alone', async () => {
  const restore = serveProjects(workspace);
  try {
    const app = mountShell(`/session/${running.id}`);
    await waitFor(() => assert.equal(app.getState().selectedSession?.id, running.id));
    assert.equal(app.getState().selectedProject?.projectId, 'project-1');

    await act(async () => { app.getState().handleNewSession(workspace[1]); });
    await waitFor(() => assert.equal(app.getPathname(), '/'));

    assert.equal(app.getState().selectedProject?.projectId, 'project-2', 'the clicked project is selected');
    assert.equal(app.getState().selectedSession, null, 'a fresh chat has no session');
    assert.equal(app.getState().newSessionTrigger, 1, 'the composer resets once, not twice');
    // The running session is untouched: its row is still in the cache and no
    // navigation went near it.
    assert.deepEqual(app.getState().projects.find((row) => row.projectId === 'project-1')?.sessions?.map((row) => row.id), [running.id]);
  } finally {
    restore();
  }
});

test('one click on another project row leaves the session route for that project', async () => {
  const restore = serveProjects(workspace);
  try {
    const app = mountShell(`/session/${running.id}`);
    await waitFor(() => assert.equal(app.getState().selectedSession?.id, running.id));

    await act(async () => { app.getState().handleProjectSelect(workspace[1]); });
    await waitFor(() => assert.equal(app.getPathname(), '/'));

    assert.equal(app.getState().selectedProject?.projectId, 'project-2');
    assert.equal(app.getState().selectedSession, null);
  } finally {
    restore();
  }
});

test('a fresh chat survives the projects-cache writes a running session keeps pushing in', async () => {
  const restore = serveProjects(workspace);
  try {
    const app = mountShell(`/session/${running.id}`);
    await waitFor(() => assert.equal(app.getState().selectedSession?.id, running.id));

    await act(async () => { app.getState().handleNewSession(workspace[1]); });
    await waitFor(() => assert.equal(app.getPathname(), '/'));

    // The session the user walked away from keeps reporting progress.
    await act(async () => { await app.getState().fetchProjects(); });
    assert.equal(app.getState().selectedProject?.projectId, 'project-2');
    assert.equal(app.getState().selectedSession, null);
  } finally {
    restore();
  }
});
