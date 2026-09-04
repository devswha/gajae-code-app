import { FlaskConical, Folder, FolderPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useProjectsQuery } from '../../../hooks/useProjectsQuery';
import { Button } from '../../../shared/view/ui/Button';
import { useAppShellStore } from '../../../stores/useAppShellStore';
import { useScratchWorkspace } from '../hooks/useScratchWorkspace';
import type { MainContentStateViewProps } from '../types/types';

import MobileMenuButton from './MobileMenuButton';

export default function MainContentStateView({
  mode,
  isMobile,
  onMenuClick,
  onNewSession,
}: MainContentStateViewProps) {
  const { t } = useTranslation();
  const openNewProject = useAppShellStore((state) => state.setNewProjectOpen);
  const { data: projects } = useProjectsQuery();
  const scratch = useScratchWorkspace(onNewSession);

  const isLoading = mode === 'loading';
  // Nothing to pick from yet: the pane's one job is to add the first project,
  // and the button does it. "Pick a project" is for a workspace that has some.
  const noProjects = (projects?.length ?? 0) === 0;

  return (
    <div className="flex h-full flex-col">
      {isMobile && (
        <div className="pwa-header-safe shrink-0 border-b border-border/50 bg-background/80 p-2 backdrop-blur-xs sm:p-3">
          <MobileMenuButton onMenuClick={onMenuClick} compact />
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-muted-foreground">
            <div className="mx-auto mb-4 h-10 w-10">
              <div
                className="h-full w-full rounded-full border-[3px] border-muted border-t-primary"
                style={{
                  animation: 'spin 1s linear infinite',
                  WebkitAnimation: 'spin 1s linear infinite',
                  MozAnimation: 'spin 1s linear infinite',
                }}
              />
            </div>
            <h2 className="mb-1 text-lg font-semibold text-foreground">{t('mainContent.loading')}</h2>
            <p className="text-sm">{t('mainContent.settingUpWorkspace')}</p>
          </div>
        </div>
      ) : noProjects ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="mx-auto max-w-md px-6 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
              <FolderPlus className="h-7 w-7 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-foreground">{t('mainContent.firstProject')}</h2>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{t('mainContent.firstProjectDescription')}</p>
            <Button type="button" onClick={() => openNewProject(true)} data-testid="main-add-project">
              <FolderPlus className="size-4" aria-hidden />
              {t('mainContent.addProject')}
            </Button>
            {/* No folder to pick yet: one click makes a disposable one and opens a conversation in it. */}
            <div className="mt-6 border-t border-border/60 pt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => { void scratch.start(); }}
                disabled={scratch.isStarting}
                data-testid="main-start-scratch"
              >
                <FlaskConical className="size-4" aria-hidden />
                {scratch.isStarting ? t('mainContent.scratchStarting') : t('mainContent.scratchStart')}
              </Button>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('mainContent.scratchDescription')}</p>
              {scratch.error && (
                <p className="mt-2 text-xs text-destructive" role="alert">{t('mainContent.scratchFailed', { reason: scratch.error })}</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="mx-auto max-w-md px-6 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
              <Folder className="h-7 w-7 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-foreground">{t('mainContent.chooseProject')}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{t('mainContent.selectProjectDescription')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
