import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import '../../../index.css';
import { PaletteOpsProvider } from '../../../contexts/PaletteOpsContext';
import type { Project } from '../../../types/app';
import { useSidebarController } from '../hooks/useSidebarController';
import SidebarContent from '../view/subcomponents/SidebarContent';

const requests: string[] = [];
const fixtureProjects: Project[] = [{
  projectId: 'active-project',
  displayName: 'Active Workspace',
  fullPath: '/workspace/active',
  sessions: [],
  sessionMeta: { total: 0 },
}];

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.toString();
  const method = init.method ?? 'GET';
  requests.push(`${method} ${url}`);

  if (window.archiveFixtureScenario === 'failure' && url.endsWith('/archived')) {
    return new Response(null, { status: 500 });
  }

  if (url === '/api/projects/archived') {
    return Response.json({
      success: true,
      data: {
        projects: [{
          projectId: 'archived-project',
          displayName: 'Archived Workspace',
          fullPath: '/workspace/archived',
          sessions: [],
          sessionMeta: { total: 0 },
          isArchived: true,
        }],
      },
    });
  }

  if (url === '/api/providers/sessions/archived') {
    return Response.json({
      success: true,
      data: {
        sessions: [{
          sessionId: 'archived-session',
          provider: 'gjc',
          projectId: null,
          projectPath: '/workspace/archived',
          projectDisplayName: 'Archived Workspace',
          sessionTitle: 'Archived Session',
          createdAt: null,
          updatedAt: null,
          lastActivity: null,
          isProjectArchived: false,
        }],
      },
    });
  }

  return Response.json({ success: true });
};

function ArchiveFixture() {
  const { t } = useTranslation(['sidebar']);
  const [refreshCount, setRefreshCount] = useState(0);
  const controller = useSidebarController({
    projects: fixtureProjects,
    selectedProject: null,
    selectedSession: null,
    isLoading: false,
    isMobile: false,
    t,
    onRefresh: () => setRefreshCount((count) => count + 1),
    onProjectSelect: () => {},
    onSessionSelect: () => {},
    setSidebarVisible: () => {},
    sidebarVisible: true,
  });

  return (
    <main className="h-screen w-72" data-testid="archive-fixture">
      <SidebarContent
        isPWA={false}
        isMobile={false}
        isArchiveOpen={controller.isArchiveOpen}
        archivedProjects={controller.archivedProjects}
        archivedSessions={controller.archivedSessions}
        archivedSessionsCount={controller.archivedSessionsCount}
        isArchivedSessionsLoading={controller.isArchivedSessionsLoading}
        archiveLoadError={controller.archiveLoadError}
        onOpenArchive={controller.openArchive}
        onCloseArchive={controller.closeArchive}
        onRestoreArchivedProject={controller.restoreArchivedProject}
        onArchivedSessionClick={controller.openArchivedSession}
        onRestoreArchivedSession={controller.restoreArchivedSession}
        onDeleteArchivedSession={(session) => controller.showDeleteSessionConfirmation(
          session.projectId,
          session.sessionId,
          session.sessionTitle,
          session.provider,
          { isArchived: true },
        )}
        onRefresh={controller.refreshProjects}
        isRefreshing={controller.isRefreshing}
        onSearch={() => {}}
        onCreateProject={() => controller.setShowNewProject(true)}
        onCollapseSidebar={controller.collapseSidebar}
        currentVersion="fixture"
        onShowSettings={() => {}}
        projectListProps={{
          projects: fixtureProjects,
          filteredProjects: fixtureProjects,
          selectedProject: null,
          selectedSession: null,
          isLoading: false,
          loadingProgress: null,
          expandedProjects: new Set(),
          editingProject: null,
          editingName: '',
          initialSessionsLoaded: new Set(['active-project']),
          currentTime: new Date(),
          editingSession: null,
          editingSessionName: '',
          deletingProjects: new Set(),
          getProjectSessions: controller.getProjectSessions,
          onLoadMoreSessions: controller.loadMoreSessionsForProject,
          loadingMoreProjects: new Set(),
          activeSessions: new Map(),
          attentionSessionIds: new Set(),
          isProjectStarred: controller.isProjectStarred,
          onEditingNameChange: controller.setEditingName,
          onToggleProject: controller.toggleProject,
          onProjectSelect: controller.handleProjectSelect,
          onToggleStarProject: controller.toggleStarProject,
          onStartEditingProject: controller.startEditing,
          onCancelEditingProject: controller.cancelEditing,
          onSaveProjectName: controller.saveProjectName,
          onDeleteProject: controller.requestProjectDelete,
          onSessionSelect: controller.handleSessionClick,
          onDeleteSession: controller.showDeleteSessionConfirmation,
          onNewSession: () => {},
          onEditingSessionNameChange: controller.setEditingSessionName,
          onStartEditingSession: controller.setEditingSession,
          onCancelEditingSession: () => controller.setEditingSessionName(''),
          onSaveEditingSession: controller.updateSessionSummary,
          t,
        }}
        t={t}
      />
      {controller.sessionDeleteConfirmation ? (
        <button onClick={() => void controller.confirmDeleteSession(true)}>
          Confirm permanent deletion
        </button>
      ) : null}
      <output data-testid="refresh-count">{refreshCount}</output>
      <output data-testid="requests">{requests.join('\n')}</output>
    </main>
  );
}

declare global {
  interface Window {
    archiveFixtureScenario: 'success' | 'failure';
  }
}

window.archiveFixtureScenario = 'success';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Archive fixture root is unavailable');
}

createRoot(rootElement).render(
  <PaletteOpsProvider>
    <ArchiveFixture />
  </PaletteOpsProvider>,
);
