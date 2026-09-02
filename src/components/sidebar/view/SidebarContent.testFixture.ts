import type { ComponentProps } from 'react';
import { createInstance, type TFunction } from 'i18next';

import type { SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { SessionStatus } from '../../../stores/sessionStatusModel';
import type { Project } from '../../../types/app';

import type SidebarContent from './SidebarContent';

export const sidebarProjectsFixture: Project[] = [
  {
    projectId: 'project-alpha',
    displayName: 'Alpha Workspace',
    fullPath: '/work/alpha',
    sessions: [
      {
        id: 'session-running',
        summary: 'Implement navigation cleanup',
        created_at: '2026-07-21T10:00:00.000Z',
        lastActivity: '2026-07-21T10:15:00.000Z',
        messageCount: 3,
        __provider: 'gjc',
      },
    ],
    sessionMeta: { total: 1 },
  },
  {
    projectId: 'project-beta',
    displayName: 'Beta Workspace',
    fullPath: '/work/beta',
    sessions: [
      {
        id: 'session-attention',
        summary: 'Review pending decision',
        created_at: '2026-07-21T09:00:00.000Z',
        lastActivity: '2026-07-21T09:30:00.000Z',
        messageCount: 1,
        __provider: 'claude',
      },
    ],
    sessionMeta: { total: 1 },
  },
];

export async function makeSidebarT(): Promise<TFunction> {
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
          filter: {
            placeholder: 'Filter conversations',
            clear: 'Clear filter',
            noMatches: 'No conversations match “{{query}}”',
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

export const sidebarSessionStatusesFixture: Record<string, SessionStatus> = {
  'session-running': 'running',
  'session-attention': 'needs_input',
};

export function sidebarContentPropsFixture(t: TFunction): ComponentProps<typeof SidebarContent> {
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
      getSessionStatus: (sessionId) => sidebarSessionStatusesFixture[sessionId] ?? 'idle',
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
