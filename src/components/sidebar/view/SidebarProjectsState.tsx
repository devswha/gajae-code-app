import { Folder } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { LoadingProgress } from '../../../types/app';

type SidebarProjectsStateProps = {
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
                className="mx-auto max-w-[200px] truncate text-xs text-muted-foreground/70"
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

  if (projectsCount === 0) {
    return (
      <div className="px-3 py-5 text-left">
        <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-muted">
          <Folder className="size-4 text-muted-foreground" />
        </div>
        <h3 className="mb-1 text-sm font-medium text-foreground">{t('projects.noProjects')}</h3>
        <p className="text-xs text-muted-foreground">{t('projects.createProjectHint')}</p>
      </div>
    );
  }

  return null;
}
