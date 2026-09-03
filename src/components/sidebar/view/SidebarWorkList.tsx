import { Button } from '../../../shared/view/ui';
import { collectWorkRows } from '../utils/workList';

import SidebarProjectsState from './SidebarProjectsState';
import SidebarSessionItem from './SidebarSessionItem';
import type { SidebarProjectListProps } from './SidebarProjectList';

type SidebarWorkListProps = {
  readonly projectListProps: SidebarProjectListProps;
  /** Render nothing when empty; the host is already explaining why (an active filter). */
  readonly quietWhenEmpty?: boolean;
};

export default function SidebarWorkList({ projectListProps, quietWhenEmpty = false }: SidebarWorkListProps) {
  const {
    projects,
    filteredProjects,
    selectedSession,
    isLoading,
    isMobile,
    loadingProgress,
    initialSessionsLoaded,
    currentTime,
    editingSession,
    editingSessionName,
    getProjectSessions,
    onLoadMoreSessions,
    loadingMoreProjects,
    activeSessions,
    getSessionStatus,
    onProjectSelect,
    onSessionSelect,
    onDeleteSession,
    onEditingSessionNameChange,
    onStartEditingSession,
    onCancelEditingSession,
    onSaveEditingSession,
    onToggleSessionStar,
    onRegenerateTitle,
    onExportSession,
    t,
  } = projectListProps;

  const sessionRows = collectWorkRows({ filteredProjects, getProjectSessions, getSessionStatus });
  // The rows here come from every project at once, so paging is one control
  // that pulls the next page of each project with more; one anonymous button
  // per project read as the same button repeated.
  const moreProjects = filteredProjects.filter((project) => project.sessionMeta?.hasMore);
  const loadingMore = moreProjects.some((project) => loadingMoreProjects.has(project.projectId));

  if (isLoading || projects.length === 0) {
    return (
      <SidebarProjectsState
        isLoading={isLoading}
        loadingProgress={loadingProgress}
        projectsCount={projects.length}
        filteredProjectsCount={filteredProjects.length}
        t={t}
      />
    );
  }

  if (sessionRows.length === 0) {
    if (quietWhenEmpty) return null;
    const isLoadingSessions = filteredProjects.some((project) => !initialSessionsLoaded.has(project.projectId));
    return (
      <div className="px-3 py-4 text-left">
        <p className="text-sm text-muted-foreground">
          {isLoadingSessions ? t('sessions.loadingSessions') : t('sessions.noSessions')}
        </p>
        {!isLoadingSessions && <p className="mt-1 text-xs text-muted-foreground/70">{t('sessions.createSessionHint')}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-0.5 pb-1">
      {sessionRows.map(({ project, session, status }) => (
        <SidebarSessionItem
          key={`${project.projectId}:${session.id}`}
          project={project}
          session={session}
          selectedSession={selectedSession}
          isProcessing={activeSessions.has(session.id)}
          status={status}
          isMobile={isMobile}
          showProjectName
          compact
          currentTime={currentTime}
          editingSession={editingSession}
          editingSessionName={editingSessionName}
          onEditingSessionNameChange={onEditingSessionNameChange}
          onStartEditingSession={onStartEditingSession}
          onCancelEditingSession={onCancelEditingSession}
          onSaveEditingSession={onSaveEditingSession}
          onToggleSessionStar={onToggleSessionStar}
          onRegenerateTitle={onRegenerateTitle}
          onExportSession={onExportSession}
          onProjectSelect={onProjectSelect}
          onSessionSelect={onSessionSelect}
          onDeleteSession={onDeleteSession}
          t={t}
        />
      ))}

      {moreProjects.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-center text-xs text-muted-foreground hover:text-foreground"
          onClick={() => moreProjects.forEach((project) => onLoadMoreSessions(project.projectId))}
          disabled={loadingMore}
        >
          {loadingMore ? t('sessions.loadingSessions') : t('sessions.showMore')}
        </Button>
      )}
    </div>
  );
}
