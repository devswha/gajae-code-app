import { Button } from '../../../shared/view/ui';
import { collectWorkRows } from '../utils/workList';

import SidebarProjectsState from './SidebarProjectsState';
import SidebarSessionItem from './SidebarSessionItem';
import type { SidebarProjectListProps } from './SidebarProjectList';

type SidebarWorkListProps = {
  readonly projectListProps: SidebarProjectListProps;
};

export default function SidebarWorkList({ projectListProps }: SidebarWorkListProps) {
  const {
    projects,
    filteredProjects,
    selectedSession,
    isLoading,
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
    onExportSession,
    t,
  } = projectListProps;

  const sessionRows = collectWorkRows({ filteredProjects, getProjectSessions, getSessionStatus });

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
          onExportSession={onExportSession}
          onProjectSelect={onProjectSelect}
          onSessionSelect={onSessionSelect}
          onDeleteSession={onDeleteSession}
          t={t}
        />
      ))}

      {filteredProjects.filter((project) => project.sessionMeta?.hasMore).map((project) => (
        <Button
          key={project.projectId}
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-center text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onLoadMoreSessions(project.projectId)}
          disabled={loadingMoreProjects.has(project.projectId)}
        >
          {loadingMoreProjects.has(project.projectId)
            ? t('sessions.loadingSessions')
            : t('sessions.showMore')}
        </Button>
      ))}
    </div>
  );
}
