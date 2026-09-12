import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SessionStore } from '../../../stores/useSessionStore';

import AgentSidebarEnvironment, { type AgentSidebarEnvironmentProps } from './AgentSidebarEnvironment';
import AgentSidebarWork from './AgentSidebarWork';
import AgentSidebarActionRequired from './AgentSidebarActionRequired';

export type AgentSidebarProps = AgentSidebarEnvironmentProps & {
  isMobile: boolean;
  /** Dismisses the mobile drawer; desktop is shown and hidden from the header toggle. */
  onClose: () => void;
  /** The chat's session store; the WORK block reads the todo fold from the window the transcript uses. */
  sessionStore: SessionStore;
};

/**
 * The experimental right-hand surface that will replace the Workspace panel.
 *
 * On desktop it is a context lane beside the conversation: a fixed-width
 * column with no border, background, header or resize handle of its own,
 * holding one compact card: the Environment summary, and under it a WORK
 * block that appears only when the session has a todo list or is running,
 * followed by Action required while the session awaits an answer.
 * The rest of the lane stays empty on purpose — the surface is workspace
 * context next to the chat, not another tool sidebar. The header's rail
 * toggle is the way to show and hide it.
 *
 * On mobile it is the same drawer as before: a backdrop, a titled header with
 * the close control, and the same blocks underneath.
 *
 * There is intentionally no tab strip and no expanded mode, and the shell
 * keeps no domain data of its own: the Environment block reads git and the
 * runtime through their existing hooks, and the WORK block projects the
 * session's todos and run state through theirs. Action required reads the
 * existing attention store and links to the chat's original request cards.
 */
export default function AgentSidebar({
  isMobile,
  projectId,
  projectPath,
  sessionId,
  onClose,
  sessionStore,
}: AgentSidebarProps) {
  const { t } = useTranslation();

  const environment = <AgentSidebarEnvironment projectId={projectId} projectPath={projectPath} sessionId={sessionId} />;
  const work = <AgentSidebarWork sessionId={sessionId} sessionStore={sessionStore} />;
  const actionRequired = <AgentSidebarActionRequired sessionId={sessionId} onRequestShown={isMobile ? onClose : undefined} />;

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
          <div className="min-h-0 flex-1 overflow-y-auto">{environment}{work}{actionRequired}</div>
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
      <div className="rounded-xl border border-border/60 bg-card/50">{environment}{work}{actionRequired}</div>
    </aside>
  );
}
