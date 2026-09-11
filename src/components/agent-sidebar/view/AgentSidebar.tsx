import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MAX_AGENT_SIDEBAR_WIDTH, MIN_AGENT_SIDEBAR_WIDTH } from '../agentSidebarState';

import AgentSidebarEnvironment, { type AgentSidebarEnvironmentProps } from './AgentSidebarEnvironment';

export type AgentSidebarProps = AgentSidebarEnvironmentProps & {
  width: number;
  isMobile: boolean;
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onClose: () => void;
};

/**
 * The Agent sidebar shell that will replace the Workspace panel: one column,
 * one width, one close control, and the Environment summary as its stable
 * content whether or not an agent is working.
 *
 * It renders exactly what its props say. There is intentionally no tab strip
 * and no expanded mode. The shell keeps no domain data of its own: the
 * Environment block reads git and the runtime through their existing hooks,
 * and the activity surfaces land in later PRs.
 */
export default function AgentSidebar({
  width,
  isMobile,
  projectId,
  projectPath,
  sessionId,
  onResizeStart,
  onResizeKeyDown,
  onClose,
}: AgentSidebarProps) {
  const { t } = useTranslation();

  const header = (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
      <h2 className="truncate text-sm font-medium text-foreground">{t('agentSidebar.title')}</h2>
      <button
        type="button"
        aria-label={t('agentSidebar.close')}
        title={t('agentSidebar.close')}
        onClick={onClose}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const body = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <AgentSidebarEnvironment projectId={projectId} projectPath={projectPath} sessionId={sessionId} />
    </div>
  );

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          aria-label={t('agentSidebar.close')}
          onClick={onClose}
          className="fixed inset-0 z-30 bg-background/80 backdrop-blur-xs"
        />
        <aside
          aria-label={t('agentSidebar.title')}
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[85vw] flex-col overflow-x-hidden border-l border-border/60 bg-sidebar shadow-xl"
        >
          {header}
          {body}
        </aside>
      </>
    );
  }

  return (
    <div className="flex min-h-0 shrink-0" style={{ width: `${width}px`, minWidth: `${MIN_AGENT_SIDEBAR_WIDTH}px` }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('agentSidebar.resize')}
        aria-valuenow={Math.round(width)}
        aria-valuemin={MIN_AGENT_SIDEBAR_WIDTH}
        aria-valuemax={MAX_AGENT_SIDEBAR_WIDTH}
        tabIndex={0}
        onMouseDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
        title={t('agentSidebar.resize')}
        className="group relative w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-hidden"
      >
        <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-primary opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <aside
        aria-label={t('agentSidebar.title')}
        className="flex min-w-0 flex-1 flex-col border-l border-border/60 bg-sidebar"
      >
        {header}
        {body}
      </aside>
    </div>
  );
}
