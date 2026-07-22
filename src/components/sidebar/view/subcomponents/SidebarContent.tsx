import { useState } from 'react';
import type { TFunction } from 'i18next';

import { ScrollArea } from '../../../../shared/view/ui';
import type { ArchivedProjectListItem, ArchivedSessionListItem } from '../../types/types';

import SidebarArchiveContent from './SidebarArchiveContent';
import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarNavigationTabs from './SidebarNavigationTabs';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';
import SidebarSection from './SidebarSection';
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
  const canCreateSession = selectedProject !== null
    && projectListProps.projects.some((project) => project.projectId === selectedProject.projectId);

  const createSession = () => {
    if (!canCreateSession || !selectedProject) {
      return;
    }
    projectListProps.onNewSession(selectedProject);
  };

  return (
    <div
      className="flex h-full flex-col bg-background md:w-72 md:select-none"
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
        <SidebarNavigationTabs
          canCreateSession={canCreateSession}
          onCreateProject={onCreateProject}
          onCreateSession={createSession}
          t={t}
        />
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
            <SidebarSection
              id="sidebar-projects"
              title={t('projects.title')}
              open={projectsOpen}
              onOpenChange={setProjectsOpen}
              actionLabel={t('tooltips.createProject')}
              onAction={onCreateProject}
            >
              <SidebarProjectList {...projectListProps} showSessions />
            </SidebarSection>
            <SidebarSection
              id="sidebar-work"
              title={t('sessions.work')}
              open={workOpen}
              onOpenChange={setWorkOpen}
            >
              <SidebarWorkList projectListProps={projectListProps} />
            </SidebarSection>
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
