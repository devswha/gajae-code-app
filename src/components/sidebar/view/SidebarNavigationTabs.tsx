import { SquarePen } from 'lucide-react';
import type { TFunction } from 'i18next';

type SidebarNavigationTabsProps = {
  readonly canCreateSession: boolean;
  readonly onCreateSession: () => void;
  readonly t: TFunction;
};

/**
 * The Codex sidebar uses one clear primary action instead of mode tabs.
 * Project creation remains a separate action in the Projects section.
 */
export default function SidebarNavigationTabs({
  canCreateSession,
  onCreateSession,
  t,
}: SidebarNavigationTabsProps) {
  const newTaskLabel = t('sessions.newTask', 'New task');

  return (
    <nav className="shrink-0 px-2 pb-2" aria-label={t('navigation.primary', 'Primary navigation')}>
      <button
        type="button"
        className="group flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[0.9375rem] font-medium text-foreground outline-hidden transition-colors hover:bg-accent/70 focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onCreateSession}
        aria-label={newTaskLabel}
        disabled={!canCreateSession}
        title={canCreateSession
          ? newTaskLabel
          : t('tooltips.selectProjectToCreateSession', 'Add a project before starting a new task')}
      >
        <SquarePen className="stroke-1.8 size-4.5 shrink-0 text-foreground" aria-hidden />
        <span className="truncate">{newTaskLabel}</span>
      </button>
    </nav>
  );
}
