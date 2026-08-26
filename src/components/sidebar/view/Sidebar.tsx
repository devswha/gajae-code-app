import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useProjectsQuery } from '../../../hooks/useProjectsQuery';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSidebarController } from '../hooks/useSidebarController';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import { useAppShellStore } from '../../../stores/useAppShellStore';
import type { LLMProvider, Project } from '../../../types/app';
import type { SidebarProps } from '../types/types';

import SidebarCollapsed from './subcomponents/SidebarCollapsed';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';
import type { SidebarProjectListProps } from './subcomponents/SidebarProjectList';

function Sidebar({
  activeSessions,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onLoadMoreSessions,
  onProjectDelete,
  onRefresh,
  isMobile,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { currentVersion } = useVersionCheck('devswha', 'gajae-app');
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const paletteOps = usePaletteOps();
  const projectsQuery = useProjectsQuery();
  const projects = projectsQuery.data ?? [];
  const isLoading = projectsQuery.isLoading;
  const selectedProject = useAppShellStore((state) => state.selectedProject);
  const selectedSession = useAppShellStore((state) => state.selectedSession);
  const attentionSessionIds = useAppShellStore((state) => state.attentionSessionIds);
  const loadingProgress = useAppShellStore((state) => state.loadingProgress);
  const showSettings = useAppShellStore((state) => state.showSettings);
  const settingsInitialTab = useAppShellStore((state) => state.settingsInitialTab);
  const openSettings = useAppShellStore((state) => state.openSettings);
  const setShowSettings = useAppShellStore((state) => state.setShowSettings);

  const {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    initialSessionsLoaded,
    currentTime,
    isRefreshing,
    editingSession,
    editingSessionName,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    filteredProjects,
    isArchiveOpen,
    archiveLoadError,
    archivedProjects,
    archivedSessions,
    archivedSessionsCount,
    isArchivedSessionsLoading,
    toggleProject,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    getProjectSessions,
    loadingMoreProjects,
    loadMoreSessionsForProject,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    requestProjectDelete,
    confirmDeleteProject,
    handleProjectSelect,
    openArchivedSession,
    restoreArchivedProject,
    restoreArchivedSession,
    openArchive,
    closeArchive,
    refreshProjects,
    updateSessionSummary,
    toggleSessionStar,
    exportSession,
    collapseSidebar: handleCollapseSidebar,
    expandSidebar: handleExpandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
  } = useSidebarController({
    projects,
    selectedProject,
    selectedSession,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onLoadMoreSessions,
    onProjectDelete,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
  });

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  const handleProjectCreated = () => {
    void paletteOps.refreshProjects();
  };

  // Sandbox project visibility: a clean first run shows nothing (Codex-style),
  // because every pre-existing project is discovered as 'legacy'/'auto'. Only
  // projects the user explicitly creates or opens in-app ('explicit') surface in
  // the sidebar, and they persist across relaunches via the DB. Backend rows are
  // untouched, so this is fully reversible by removing the filter.
  const isSandboxVisibleProject = (project: Project) => project.origin === 'explicit';
  const sandboxProjects = projects.filter(isSandboxVisibleProject);
  const sandboxFilteredProjects = filteredProjects.filter(isSandboxVisibleProject);

  const projectListProps: SidebarProjectListProps = {
    projects: sandboxProjects,
    filteredProjects: sandboxFilteredProjects,
    selectedProject,
    selectedSession,
    isLoading,
    loadingProgress,
    expandedProjects,
    editingProject,
    editingName,
    initialSessionsLoaded,
    currentTime,
    editingSession,
    editingSessionName,
    deletingProjects,
    getProjectSessions,
    loadingMoreProjects,
    activeSessions,
    attentionSessionIds,
    isProjectStarred,
    onEditingNameChange: setEditingName,
    onToggleProject: toggleProject,
    onProjectSelect: handleProjectSelect,
    onToggleStarProject: toggleStarProject,
    onStartEditingProject: startEditing,
    onCancelEditingProject: cancelEditing,
    onSaveProjectName: (projectName) => {
      void saveProjectName(projectName);
    },
    onDeleteProject: requestProjectDelete,
    onSessionSelect: handleSessionClick,
    onDeleteSession: showDeleteSessionConfirmation,
    onLoadMoreSessions: loadMoreSessionsForProject,
    onNewSession,
    onEditingSessionNameChange: setEditingSessionName,
    onStartEditingSession: (sessionId, initialName) => {
      setEditingSession(sessionId);
      setEditingSessionName(initialName);
    },
    onCancelEditingSession: () => {
      setEditingSession(null);
      setEditingSessionName('');
    },
    onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => {
      void updateSessionSummary(projectName, sessionId, summary, provider);
    },
    onToggleSessionStar: (sessionId: string) => {
      void toggleSessionStar(sessionId);
    },
    onExportSession: (sessionId: string) => {
      void exportSession(sessionId);
    },
    t,
  };

  return (
    <>
        <SidebarModals
          projects={projects}
          showSettings={showSettings}
          settingsInitialTab={settingsInitialTab}
          onCloseSettings={() => setShowSettings(false)}
          showNewProject={showNewProject}
          onCloseNewProject={() => setShowNewProject(false)}
          onProjectCreated={handleProjectCreated}
          deleteConfirmation={deleteConfirmation}
          onCancelDeleteProject={() => setDeleteConfirmation(null)}
          onConfirmDeleteProject={confirmDeleteProject}
          sessionDeleteConfirmation={sessionDeleteConfirmation}
          onCancelDeleteSession={() => setSessionDeleteConfirmation(null)}
          onConfirmDeleteSession={confirmDeleteSession}
          t={t}
        />

      {isSidebarCollapsed ? (
        <SidebarCollapsed
          onExpand={handleExpandSidebar}
          onShowSettings={() => openSettings()}
          t={t}
        />
      ) : (
        <>
        <SidebarContent
            isPWA={isPWA}
            isMobile={isMobile}
            isArchiveOpen={isArchiveOpen}
            archivedProjects={archivedProjects}
            archivedSessions={archivedSessions}
            archivedSessionsCount={archivedSessionsCount}
            isArchivedSessionsLoading={isArchivedSessionsLoading}
            archiveLoadError={archiveLoadError}
            onOpenArchive={openArchive}
            onCloseArchive={closeArchive}
            onRestoreArchivedProject={restoreArchivedProject}
            onArchivedSessionClick={openArchivedSession}
            onRestoreArchivedSession={restoreArchivedSession}
            onDeleteArchivedSession={(session) => {
              showDeleteSessionConfirmation(
                session.projectId,
                session.sessionId,
                session.sessionTitle,
                session.provider,
                { isArchived: true },
              );
            }}
            onRefresh={() => {
              void refreshProjects();
            }}
            isRefreshing={isRefreshing}
            onSearch={paletteOps.openCommandPalette}
            onCreateProject={() => setShowNewProject(true)}
            onCollapseSidebar={handleCollapseSidebar}
            currentVersion={currentVersion}
            onShowSettings={() => openSettings()}
            projectListProps={projectListProps}
            t={t}
          />
        </>
      )}

    </>
  );
}

export default Sidebar;
