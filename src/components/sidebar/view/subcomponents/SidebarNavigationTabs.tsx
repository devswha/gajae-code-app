import { SquarePen } from 'lucide-react';
import type { TFunction } from 'i18next';

type SidebarNavigationTabsProps = {
  readonly canCreateSession: boolean;
  readonly onCreateProject: () => void;
  readonly onCreateSession: () => void;
  readonly t: TFunction;
};

/**
 * The Codex sidebar uses one clear primary action instead of mode tabs.
 * If there is no selected project yet, the same action starts with project
 * creation so the user never lands on a disabled dead end.
 */
export default function SidebarNavigationTabs({
  canCreateSession,
  onCreateProject,
  onCreateSession,
  t,
}: SidebarNavigationTabsProps) {
  const newTaskLabel = t('sessions.newTask', 'New task');

  return (
    <nav className="flex-shrink-0 px-2 pb-2" aria-label={t('navigation.primary', 'Primary navigation')}>
      <button
        type="button"
        className="group flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[0.9375rem] font-medium text-foreground outline-none transition-colors hover:bg-accent/70 focus-visible:ring-1 focus-visible:ring-ring"
        onClick={canCreateSession ? onCreateSession : onCreateProject}
        aria-label={newTaskLabel}
        title={canCreateSession
          ? newTaskLabel
          : t('sessions.newTaskCreatesProject', 'Create a project to start a new task')}
      >
        <SquarePen className="size-[1.125rem] flex-shrink-0 stroke-[1.8] text-foreground" aria-hidden />
        <span className="truncate">{newTaskLabel}</span>
      </button>
    </nav>
  );
}
