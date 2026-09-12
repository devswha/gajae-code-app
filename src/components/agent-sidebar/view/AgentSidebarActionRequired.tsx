import { ArrowUpRight, MessageCircleQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useSessionAttentionStore } from '../../../stores/useSessionAttentionStore';
import { focusPermissionRequest } from '../../chat/utils/permissionRequestFocus';

type Props = {
  sessionId?: string;
  /** Dismiss the mobile drawer only after the request in the chat was reached. */
  onRequestShown?: () => void;
};

/** A projection of real unanswered requests, never failed or unread outcomes. */
export default function AgentSidebarActionRequired({ sessionId, onRequestShown }: Props) {
  const { t } = useTranslation();
  const pending = useSessionAttentionStore((state) => sessionId ? state.pendingInput[sessionId] : undefined);
  if (!pending?.requestIds.length) return null;

  // A running-sessions poll can know about a request before chat_subscribed
  // restores its card. The store's server marker is not an actionable request.
  const canShowRequest = pending.requestIds.some((id) => !id.startsWith('server:'));
  const showRequest = () => {
    if (focusPermissionRequest(pending.requestIds)) onRequestShown?.();
  };

  return (
    <section aria-labelledby="agent-sidebar-action-required" className="border-t border-border/50 px-1 pt-1 pb-2 text-xs">
      <h3 id="agent-sidebar-action-required" className="mb-1 px-2 text-[10px] font-semibold tracking-wide text-muted-foreground/80 uppercase">
        {t('agentSidebar.actionRequired.title')}
      </h3>
      <p role="status" className="flex items-center gap-2 px-2 py-1.5 text-foreground">
        <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        {t('agentSidebar.actionRequired.waiting')}
      </p>
      <button
        type="button"
        disabled={!canShowRequest}
        onClick={showRequest}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-primary transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent sm:min-h-8"
      >
        {t(canShowRequest ? 'agentSidebar.actionRequired.viewRequest' : 'agentSidebar.actionRequired.loading')}
        {canShowRequest && <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      </button>
    </section>
  );
}
