import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance, type TFunction } from 'i18next';
import { MemoryRouter } from 'react-router-dom';

import type { SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { SessionStatus } from '../../../stores/sessionStatusModel';

import SidebarContent from './SidebarContent';
import { sidebarProjectsFixture } from './SidebarContent.testFixture';
import SidebarHeader from './SidebarHeader';

async function makeT(): Promise<TFunction> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: {
        sidebar: {
          archived: {
            emptyDescription: 'Archived workspaces and sessions will appear here when you hide them.',
            emptyTitle: 'No archived items',
            openArchive: 'Open archive',
          },
          projects: {
            createProjectHint: 'Create a workspace to start.',
            noProjects: 'No projects yet',
            searchPlaceholder: 'Search projects',
            title: 'Projects',
          },
          sessions: {
            noSessions: 'No conversations yet',
            work: 'Work',
          },
          status: {
            running: 'Running',
            needsInput: 'Waiting for your input',
            ready: 'Finished, not viewed yet',
            blocked: 'Run failed, not viewed yet',
            countRunning_one: '{{count}} running',
            countRunning_other: '{{count}} running',
            countNeedsInput_one: '{{count}} waiting for input',
            countNeedsInput_other: '{{count}} waiting for input',
            countReady_one: '{{count}} ready',
            countReady_other: '{{count}} ready',
            countBlocked_one: '{{count}} failed',
            countBlocked_other: '{{count}} failed',
            projectAttentionCount_one: '{{count}} conversation needs a look',
            projectAttentionCount_other: '{{count}} conversations need a look',
          },
          tooltips: {
            activeSessionIndicator: 'Active session',
            attentionRequiredIndicator: 'Session needs attention',
            createProject: 'Create project',
            createSession: 'Create new session',
            hideSidebar: 'Hide sidebar',
            processingSessionIndicator: 'Processing session',
            refresh: 'Refresh',
            selectProjectToCreateSession: 'Select a project before creating a session',
          },
        },
      },
    },
  });

  return i18n.getFixedT('en', 'sidebar');
}

const sessionStatuses: Record<string, SessionStatus> = {
  'session-running': 'running',
  'session-attention': 'needs_input',
};

function sidebarContentProps(t: TFunction): ComponentProps<typeof SidebarContent> {
  const activeSessions: SessionActivityMap = new Map([
    ['session-running', { statusText: null, canInterrupt: true, startedAt: 1, awaitingInput: false }],
  ]);

  return {
    isPWA: false,
    isMobile: false,
    isArchiveOpen: false,
    archivedProjects: [],
    archivedSessions: [],
    archivedSessionsCount: 0,
    isArchivedSessionsLoading: false,
    archiveLoadError: null,
    onOpenArchive: () => {},
    onCloseArchive: () => {},
    onRestoreArchivedProject: () => {},
    onArchivedSessionClick: () => {},
    onRestoreArchivedSession: () => {},
    onDeleteArchivedSession: () => {},
    onRefresh: () => {},
    isRefreshing: false,
    onSearch: () => {},
    onCreateProject: () => {},
    onCollapseSidebar: () => {},
    currentVersion: '0.0.0-test',
    onShowSettings: () => {},
    projectListProps: {
      projects: sidebarProjectsFixture,
      filteredProjects: sidebarProjectsFixture,
      selectedProject: null,
      selectedSession: null,
      isLoading: false,
      loadingProgress: null,
      expandedProjects: new Set(['project-alpha', 'project-beta']),
      editingProject: null,
      editingName: '',
      initialSessionsLoaded: new Set(['project-alpha', 'project-beta']),
      currentTime: new Date('2026-07-21T10:20:00.000Z'),
      editingSession: null,
      editingSessionName: '',
      deletingProjects: new Set(),
      getProjectSessions: (project) => project.sessions?.map((session) => ({ ...session, __provider: session.__provider ?? 'gjc' })) ?? [],
      onLoadMoreSessions: () => {},
      loadingMoreProjects: new Set(),
      activeSessions,
      getSessionStatus: (sessionId) => sessionStatuses[sessionId] ?? 'idle',
      isProjectStarred: () => false,
      onEditingNameChange: () => {},
      onToggleProject: () => {},
      onProjectSelect: () => {},
      onToggleStarProject: () => {},
      onStartEditingProject: () => {},
      onCancelEditingProject: () => {},
      onSaveProjectName: () => {},
      onDeleteProject: () => {},
      onSessionSelect: () => {},
      onDeleteSession: () => {},
      onNewSession: () => {},
      onEditingSessionNameChange: () => {},
      onStartEditingSession: () => {},
      onCancelEditingSession: () => {},
      onSaveEditingSession: () => {},
      t,
    },
    t,
  };
}

function renderSidebarContent(t: TFunction, overrides: Partial<ComponentProps<typeof SidebarContent>> = {}): string {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    null,
    createElement(SidebarContent, { ...sidebarContentProps(t), ...overrides }),
  ));
}

function renderSidebarHeader(t: TFunction): string {
  return renderToStaticMarkup(createElement(SidebarHeader, {
    isPWA: false,
    isMobile: false,
    onSearch: () => {},
    onCollapseSidebar: () => {},
    t,
  }));
}

test('baseline renders project rows, nested sessions, and row-level status indicators', async () => {
  const t = await makeT();
  const html = renderSidebarContent(t);

  assert.match(html, /Alpha Workspace/);
  assert.match(html, /Beta Workspace/);
  assert.match(html, /Implement navigation cleanup/);
  assert.match(html, /Review pending decision/);
  assert.match(html, /lucide-loader-circle/);
  assert.match(html, /aria-label="Waiting for your input"/);
  assert.equal(html.match(/src="\/mark\.svg"/g)?.length, 1);
});

function renderWithStatuses(t: TFunction, statuses: Record<string, SessionStatus>, activeIds: string[] = []): string {
  const base = sidebarContentProps(t);
  return renderSidebarContent(t, {
    projectListProps: {
      ...base.projectListProps,
      activeSessions: new Map(activeIds.map((id) => [id, { statusText: null, canInterrupt: true, startedAt: 1, awaitingInput: false }])),
      getSessionStatus: (sessionId) => statuses[sessionId] ?? 'idle',
    },
  });
}

test('each session status gets its own indicator and accessible label', async () => {
  const t = await makeT();

  const running = renderWithStatuses(t, { 'session-running': 'running' }, ['session-running']);
  assert.match(running, /aria-label="Running"[^>]*data-session-status="running"/);
  assert.match(running, /lucide-loader-circle/);

  const needsInput = renderWithStatuses(t, { 'session-running': 'needs_input' });
  assert.match(needsInput, /aria-label="Waiting for your input"[^>]*data-session-status="needs_input"[^>]*class="[^"]*bg-primary/);
  assert.match(needsInput, /lucide-circle-alert/);

  const ready = renderWithStatuses(t, { 'session-running': 'ready' });
  assert.match(ready, /aria-label="Finished, not viewed yet"[^>]*data-session-status="ready"[^>]*class="[^"]*bg-primary/);
  assert.doesNotMatch(ready, /data-session-status="ready"[^>]*animate-pulse/, 'a finished run does not pulse');
  assert.doesNotMatch(ready, /lucide-circle-alert|lucide-triangle-alert|lucide-loader-circle/);

  const blocked = renderWithStatuses(t, { 'session-running': 'blocked' });
  assert.match(blocked, /aria-label="Run failed, not viewed yet"[^>]*data-session-status="blocked"[^>]*class="[^"]*bg-destructive/);
  assert.match(blocked, /lucide-triangle-alert/);

  const idle = renderWithStatuses(t, {});
  assert.doesNotMatch(idle, /data-session-status="(?:running|needs_input|ready|blocked)"/);
  assert.doesNotMatch(idle, /role="status"/);
});

test('the Work section lists every non-idle session, most urgent first, with per-state counts', async () => {
  const t = await makeT();
  const html = renderWithStatuses(t, { 'session-running': 'running', 'session-attention': 'blocked' }, ['session-running']);

  const work = html.slice(html.indexOf('id="sidebar-work-content"'));
  const blockedAt = work.indexOf('Review pending decision');
  const runningAt = work.indexOf('Implement navigation cleanup');
  assert.ok(blockedAt >= 0 && runningAt >= 0, 'both sessions appear under Work');
  assert.ok(blockedAt < runningAt, 'a failed run is listed before one that is still working');

  const counts = html.match(/data-testid="sidebar-work-counts"[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.match(counts, /aria-label="1 failed"/);
  assert.match(counts, /aria-label="1 running"/);
  assert.doesNotMatch(counts, /waiting for input|ready/);
});

test('project rows show an attention badge only when a session needs a look', async () => {
  const t = await makeT();

  const quiet = renderWithStatuses(t, { 'session-running': 'running' }, ['session-running']);
  assert.doesNotMatch(quiet, /needs a look/);
  assert.doesNotMatch(quiet, /aria-label="0 conversations/);

  const attention = renderWithStatuses(t, { 'session-attention': 'ready' });
  assert.match(attention, /aria-label="1 conversation needs a look"[^>]*class="[^"]*text-primary/);

  const failed = renderWithStatuses(t, { 'session-attention': 'blocked' });
  assert.match(failed, /aria-label="1 conversation needs a look"[^>]*class="[^"]*text-destructive/);
});

test('renders the Codex-style New task action with Projects and Work sections', async () => {
  const t = await makeT();
  const html = renderSidebarContent(t);

  assert.match(html, /Alpha Workspace/);
  assert.match(html, /Implement navigation cleanup/);
  assert.match(html, /lucide-loader-circle/);
  assert.match(html, />New task</);
  const newTaskButton = html.match(/<button[^>]*aria-label="New task"[^>]*>/)?.[0];
  assert.ok(newTaskButton);
  assert.doesNotMatch(newTaskButton, /disabled/);
  assert.match(html, /id="sidebar-projects-heading"[^>]*>Projects/);
  assert.match(html, /id="sidebar-work-heading"[^>]*>Work/);
  assert.doesNotMatch(html, /role="tablist"/);
  assert.match(html, />Projects<|>Work</);
  assert.doesNotMatch(html, /Search projects/);
  assert.doesNotMatch(html, /type="text"/);
  assert.doesNotMatch(html, />Conversations<|Running sessions|Archive only/);
  assert.doesNotMatch(html, /data-job-sidebar|data-job-inbox|New job|Jobs/);
});

test('keeps search as the primary header utility', async () => {
  const t = await makeT();
  const html = renderSidebarHeader(t);

  assert.match(html, /<button[^>]+aria-label="Search"/);
  assert.match(html, /src="\/mark\.svg"/);
  assert.match(html, />Gajae Code App</);
  assert.doesNotMatch(html, />가재코드</);
  assert.doesNotMatch(html, /type="text"/);
  assert.doesNotMatch(html, />Projects<|>Conversations<|Running sessions|Archive only/);
});

test('the header wordmark is not crowded off the row by decoration', async () => {
  // The sidebar is a fixed 288px; the wordmark rendered at roughly the width
  // the row can spare, so a decorative chevron next to it was enough to clip
  // "Gajae Code App" into an ellipsis. It also implied a dropdown that never
  // existed — the row carries no non-interactive affordance now.
  const t = await makeT();
  const html = renderSidebarHeader(t);

  assert.match(html, />Gajae Code App</);
  assert.doesNotMatch(html, /aria-hidden[^>]*lucide-chevron-down|lucide-chevron-down[^>]*aria-hidden/);
  // Still recoverable if a longer localized name ever does clip.
  assert.match(html, /<h1[^>]+title="Gajae Code App"/);
});

test('renders archived project and session recovery controls through the compact archive state', async () => {
  const t = await makeT();
  const html = renderSidebarContent(t, {
    isArchiveOpen: true,
    archivedProjects: [{
      projectId: 'project-archived',
      displayName: 'Archived Workspace',
      fullPath: '/work/archived',
      sessions: [],
      sessionMeta: { total: 0 },
      isArchived: true,
    }],
    archivedSessions: [{
      sessionId: 'session-archived',
      provider: 'gjc',
      projectId: null,
      projectPath: '/work/standalone',
      projectDisplayName: 'Standalone Archive',
      sessionTitle: 'Recover this session',
      createdAt: null,
      updatedAt: null,
      lastActivity: null,
      isProjectArchived: false,
    }],
    archivedSessionsCount: 2,
  });

  assert.match(html, /Archived Workspace/);
  assert.match(html, /Recover this session/);
  assert.match(html, /aria-label="Restore workspace"/);
  assert.match(html, /aria-label="Restore session"/);
  assert.match(html, /aria-label="Delete permanently"/);
  assert.match(html, /aria-label="Back to projects"/);
});

test('renders a recoverable inline error when archive loading fails', async () => {
  const t = await makeT();
  const html = renderSidebarContent(t, {
    isArchiveOpen: true,
    archiveLoadError: 'Unable to load archive. Try again.',
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Unable to load archive. Try again\./);
  assert.doesNotMatch(html, /type="text"/);
});

test('renders the empty project state under the Projects and Work sections without Jobs controls', async () => {
  const t = await makeT();
  const emptyProps = sidebarContentProps(t);
  const html = renderSidebarContent(t, {
    projectListProps: {
      ...emptyProps.projectListProps,
      projects: [],
      filteredProjects: [],
      expandedProjects: new Set(),
      initialSessionsLoaded: new Set(),
      activeSessions: new Map(),
      getSessionStatus: () => 'idle',
    },
  });

  assert.match(html, /No projects yet/);
  assert.match(html, /id="sidebar-projects-heading"[^>]*>Projects/);
  assert.match(html, /id="sidebar-work-heading"[^>]*>Work/);
  assert.doesNotMatch(html, /Search projects/);
  assert.doesNotMatch(html, /type="text"/);
  assert.doesNotMatch(html, />Conversations<|Running sessions|Archive only/);
  assert.doesNotMatch(html, /data-job-sidebar|data-job-inbox|New job|Jobs/);
});
