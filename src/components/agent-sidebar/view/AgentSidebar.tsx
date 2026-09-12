import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AgentSidebarEnvironment, { type AgentSidebarEnvironmentProps } from './AgentSidebarEnvironment';

export type AgentSidebarProps = AgentSidebarEnvironmentProps & {
  isMobile: boolean;
  /** Dismisses the mobile drawer; desktop is shown and hidden from the header toggle. */
  onClose: () => void;
};

/**
 * The experimental right-hand surface that will replace the Workspace panel.
 *
 * On desktop it is a context lane beside the conversation: a fixed-width
 * column with no border, background, header or resize handle of its own,
 * holding one compact card that is only as tall as the Environment summary.
 * The rest of the lane stays empty on purpose — the surface is workspace
 * context next to the chat, not another tool sidebar. The header's rail
 * toggle is the way to show and hide it.
 *
 * On mobile it is the same drawer as before: a backdrop, a titled header with
 * the close control, and the summary underneath.
 *
 * There is intentionally no tab strip and no expanded mode, and the shell
 * keeps no domain data of its own: the Environment block reads git and the
 * runtime through their existing hooks.
 */
export default function AgentSidebar({
  isMobile,
  projectId,
  projectPath,
  sessionId,
  onClose,
}: AgentSidebarProps) {
  const { t } = useTranslation();

  const environment = <AgentSidebarEnvironment projectId={projectId} projectPath={projectPath} sessionId={sessionId} />;

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
          <div className="min-h-0 flex-1 overflow-y-auto">{environment}</div>
        </aside>
      </>
    );
  }

  // A narrower window gets a narrower lane so the conversation keeps its room.
  return (
    <aside
      aria-label={t('agentSidebar.title')}
      className="flex w-64 shrink-0 flex-col overflow-y-auto py-3 pr-4 pl-2 lg:w-80"
    >
      <div className="rounded-xl border border-border/60 bg-card/50">{environment}</div>
    </aside>
  );
}
