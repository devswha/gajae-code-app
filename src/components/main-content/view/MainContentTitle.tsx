import { useTranslation } from 'react-i18next';

import SessionProviderLogo from '../../llm-logo-provider/SessionProviderLogo';
import type { Project, ProjectSession } from '../../../types/app';

type MainContentTitleProps = {
  selectedProject: Project;
  selectedSession: ProjectSession | null;
};

function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
}

export default function MainContentTitle({
  selectedProject,
  selectedSession,
}: MainContentTitleProps) {
  const { t } = useTranslation();

  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {selectedSession && (
        <div className="flex h-5 w-5 shrink-0 items-center justify-center">
          <SessionProviderLogo provider={selectedSession.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {selectedSession ? (
          <div className="min-w-0">
            <h2 title={getSessionTitle(selectedSession)} className="truncate text-sm leading-tight font-semibold text-foreground">
              {getSessionTitle(selectedSession)}
            </h2>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-base leading-tight font-semibold text-foreground">{t('mainContent.newSession')}</h2>
            <div className="truncate text-xs leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        )}
      </div>
    </div>
  );
}
