import { Folder } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { LoadingProgress } from '../../../types/app';

type SidebarProjectsStateProps = {
  readonly onCreateProject?: () => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  projectsCount: number;
  filteredProjectsCount: number;
  t: TFunction;
};

export default function SidebarProjectsState({
  isLoading,
  loadingProgress,
  projectsCount,
  onCreateProject,
  t,
}: SidebarProjectsStateProps) {
  if (isLoading) {
    return (
      <div className="px-3 py-5 text-left">
        <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-muted">
          <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
        <h3 className="mb-1 text-sm font-medium text-foreground">{t('projects.loadingProjects')}</h3>
        {loadingProgress && loadingProgress.total > 0 ? (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${(loadingProgress.current / loadingProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {loadingProgress.current}/{loadingProgress.total} {t('projects.projects')}
            </p>
            {loadingProgress.currentProject && (
              <p
                className="mx-auto max-w-50 truncate text-xs text-muted-foreground/70"
                title={loadingProgress.currentProject}
              >
                {loadingProgress.currentProject.split('-').slice(-2).join('/')}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('projects.fetchingProjects')}</p>
        )}
      </div>
    );
  }

  // One line, and the line is the action: a first-time user does not know
  // the small "+" in the section header, and an explanation paragraph is
  // longer than just doing the thing.
  if (projectsCount === 0) {
    return (
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-muted-foreground outline-hidden transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onCreateProject}
        data-testid="sidebar-empty-projects"
      >
        <Folder className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{t('projects.noProjects')}</span>
        <span className="ml-auto shrink-0 text-xs text-primary">{t('projects.addFirst')}</span>
      </button>
    );
  }

  return null;
}
