import { useState } from 'react';
import type { TFunction } from 'i18next';

import { ScrollArea } from '../../../shared/view/ui';
import { useSidebarFilter } from '../hooks/useSidebarFilter';
import type { ArchivedProjectListItem, ArchivedSessionListItem } from '../types/types';
import { collectWorkRows, countWorkRows } from '../utils/workList';

import SidebarArchiveContent from './SidebarArchiveContent';
import SidebarFilterInput from './SidebarFilterInput';
import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarNavigationTabs from './SidebarNavigationTabs';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';
import SidebarSection from './SidebarSection';
import SidebarWorkCounts from './SidebarWorkCounts';
import SidebarWorkList from './SidebarWorkList';

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isArchiveOpen: boolean;
  archivedProjects: ArchivedProjectListItem[];
  archivedSessions: ArchivedSessionListItem[];
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  archiveLoadError: string | null;
  onOpenArchive: () => void;
  onCloseArchive: () => void;
  onRestoreArchivedProject: (projectId: string) => void;
  onArchivedSessionClick: (session: ArchivedSessionListItem) => void;
  onRestoreArchivedSession: (sessionId: string) => void;
  onDeleteArchivedSession: (session: ArchivedSessionListItem) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onSearch: () => void;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  currentVersion: string;
  onShowSettings: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isArchiveOpen,
  archivedProjects,
  archivedSessions,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  archiveLoadError,
  onOpenArchive,
  onCloseArchive,
  onRestoreArchivedProject,
  onArchivedSessionClick,
  onRestoreArchivedSession,
  onDeleteArchivedSession,
  onRefresh,
  isRefreshing,
  onSearch,
  onCreateProject,
  onCollapseSidebar,
  currentVersion,
  onShowSettings,
  projectListProps,
  t,
}: SidebarContentProps) {
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [workOpen, setWorkOpen] = useState(true);
  const selectedProject = projectListProps.selectedProject;
  const availableProjects = projectListProps.projects;
  const selectedProjectIsAvailable = selectedProject !== null
    && availableProjects.some((project) => project.projectId === selectedProject.projectId);
  const canCreateSession = availableProjects.length > 0;
  // Nothing to filter and nothing to report until the first project exists:
  // the empty workspace is one action (add a project) and one line saying so.
  const hasProjects = availableProjects.length > 0 || projectListProps.isLoading;
  const filter = useSidebarFilter(projectListProps);
  const listProps = filter.listProps;
  // Counts describe the whole workspace, not the filtered view: the heading is
  // a status line, and hiding a failed run behind a filter would be a lie.
  const workRows = collectWorkRows(projectListProps);
  const workCounts = countWorkRows(workRows);
  // Work is a status area - what runs, waits, failed, or finished unread. It
  // appears when there is something to report and not before; a permanent
  // empty header asking the user to start a conversation was not status.
  const showWork = hasProjects && workRows.length > 0;
  const showsFilterEmptyState = filter.active && filter.matchCount === 0 && !projectListProps.isLoading;

  const createSession = () => {
    const project = selectedProjectIsAvailable ? selectedProject : availableProjects[0];
    if (!project) {
      return;
    }
    projectListProps.onNewSession(project);
  };

  return (
    <div
      className="flex h-full flex-col bg-sidebar md:w-72 md:select-none"
      style={{}}
    >
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        onSearch={onSearch}
        onCollapseSidebar={onCollapseSidebar}
        t={t}
      />

      {!isArchiveOpen && (
        <>
          {canCreateSession && (
            <SidebarNavigationTabs
              onCreateSession={createSession}
              t={t}
            />
          )}
          {hasProjects && <SidebarFilterInput value={filter.query} onChange={filter.setQuery} inputRef={filter.inputRef} t={t} />}
        </>
      )}

      <ScrollArea className="flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
        {isArchiveOpen ? (
          <SidebarArchiveContent
            archivedProjects={archivedProjects}
            archivedSessions={archivedSessions}
            archivedSessionsCount={archivedSessionsCount}
            isArchivedSessionsLoading={isArchivedSessionsLoading}
            archiveLoadError={archiveLoadError}
            onRetry={onOpenArchive}
            onCloseArchive={onCloseArchive}
            onRestoreArchivedProject={onRestoreArchivedProject}
            onArchivedSessionClick={onArchivedSessionClick}
            onRestoreArchivedSession={onRestoreArchivedSession}
            onDeleteArchivedSession={onDeleteArchivedSession}
            t={t}
          />
        ) : (
          <div className="space-y-2">
            {showsFilterEmptyState && (
              <p className="px-3 py-2 text-sm text-muted-foreground" role="status" data-testid="sidebar-filter-empty">
                {t('filter.noMatches', { query: filter.query.trim() })}
              </p>
            )}
            <SidebarSection
              id="sidebar-projects"
              title={t('projects.title')}
              open={projectsOpen}
              onOpenChange={setProjectsOpen}
              actionLabel={t('tooltips.createProject')}
              onAction={onCreateProject}
            >
              <SidebarProjectList {...listProps} onCreateProject={onCreateProject} showSessions />
            </SidebarSection>
            {showWork && (
              <SidebarSection
                id="sidebar-work"
                title={t('sessions.work')}
                open={workOpen}
                onOpenChange={setWorkOpen}
                trailing={<SidebarWorkCounts counts={workCounts} t={t} />}
              >
                <SidebarWorkList projectListProps={listProps} />
              </SidebarSection>
            )}
          </div>
        )}
      </ScrollArea>

      <SidebarFooter
        currentVersion={currentVersion}
        onOpenArchive={onOpenArchive}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onShowSettings={onShowSettings}
        t={t}
      />
    </div>
  );
}
