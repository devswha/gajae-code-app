import { FolderPlus, SquarePen } from 'lucide-react';
import type { TFunction } from 'i18next';

type SidebarNavigationTabsProps = {
  readonly canCreateSession: boolean;
  readonly onCreateSession: () => void;
  readonly onCreateProject: () => void;
  readonly t: TFunction;
};

/**
 * One primary action, never a disabled one. With projects it starts a
 * conversation; with none, the only thing a person can do is add a project,
 * so that is the button - a greyed-out "New work item" over an empty list
 * told a first-time user nothing.
 */
export default function SidebarNavigationTabs({
  canCreateSession,
  onCreateSession,
  onCreateProject,
  t,
}: SidebarNavigationTabsProps) {
  const label = canCreateSession ? t('sessions.newTask', 'New task') : t('tooltips.createProject', 'Add a project');
  const Icon = canCreateSession ? SquarePen : FolderPlus;

  return (
    <nav className="shrink-0 px-2 pb-2" aria-label={t('navigation.primary', 'Primary navigation')}>
      <button
        type="button"
        className="group flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[0.9375rem] font-medium text-foreground outline-hidden transition-colors hover:bg-accent/70 focus-visible:ring-1 focus-visible:ring-ring"
        onClick={canCreateSession ? onCreateSession : onCreateProject}
        aria-label={label}
        title={label}
      >
        <Icon className="stroke-1.8 size-4.5 shrink-0 text-foreground" aria-hidden />
        <span className="truncate">{label}</span>
      </button>
    </nav>
  );
}
