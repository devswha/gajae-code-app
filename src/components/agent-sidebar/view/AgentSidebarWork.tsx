import { useTranslation } from 'react-i18next';

import { useSessionStatus } from '../../../contexts/SessionStatusContext';
import type { SessionStore } from '../../../stores/useSessionStore';
import { cn } from '../../../utils/cn';
import { useSessionTodos } from '../../chat/hooks/useSessionTodos';
import { TODO_STATUS_ICON } from '../../chat/view/todoStatusIcon';

const { Icon: WorkingIcon, className: workingIconClassName } = TODO_STATUS_ICON.in_progress;

export type AgentSidebarWorkProps = {
  sessionId?: string;
  /** The chat's session store; the todo fold reads the same message window the transcript uses. */
  sessionStore: SessionStore;
};

/**
 * The compact "what is the agent doing" block under the Environment summary.
 *
 * It is a projection, not a second source of truth: the tasks are the same
 * `todo_write` fold the chat's task card renders, and "running" is the
 * session-status activity the chat publishes for this exact session. Nothing
 * is inferred from tool traffic, elapsed time or transcript prose, and the
 * block owns no state of its own.
 *
 * Visibility: tasks render whenever the session has a todo list, even
 * all-completed and even while idle; a run without a list falls back to one
 * "Working" row; a session with neither is silent, so an idle session leaves
 * the Environment summary alone.
 */
export default function AgentSidebarWork({ sessionId, sessionStore }: AgentSidebarWorkProps) {
  const { t } = useTranslation();
  const status = useSessionStatus();
  const phases = useSessionTodos(sessionStore, sessionId, Boolean(sessionId));
  const hasTasks = phases.some((phase) => phase.tasks.length > 0);
  // Only the published activity of this very session counts; a snapshot left
  // over from another conversation must never read as this one running.
  const running = Boolean(sessionId) && status.sessionId === sessionId && status.activity.running;

  if (!hasTasks && !running) {
    return null;
  }

  return (
    <section aria-labelledby="agent-sidebar-work" className="border-t border-border/50 px-1 pt-1 pb-2 text-xs">
      <h3 id="agent-sidebar-work" className="mb-1 px-2 text-[10px] font-semibold tracking-wide text-muted-foreground/80 uppercase">
        {t('agentSidebar.work.title')}
      </h3>
      {hasTasks ? (
        phases.filter((phase) => phase.tasks.length > 0).map((phase, phaseIndex) => (
          <div key={`${phaseIndex}:${phase.name}`}>
            {phase.name && (
              <p className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/70">{phase.name}</p>
            )}
            <ul>
              {phase.tasks.map((task, taskIndex) => {
                const { Icon, className } = TODO_STATUS_ICON[task.status];
                return (
                  <li key={`${taskIndex}:${task.content}`} className="flex items-start gap-2 px-2 py-1" title={task.content}>
                    <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', className)} aria-hidden />
                    <span className="sr-only">{t(`workspace.tasks.status.${task.status}`)}: </span>
                    <span className={cn('min-w-0 flex-1 truncate text-foreground',
                      (task.status === 'completed' || task.status === 'abandoned') && 'text-muted-foreground line-through decoration-muted-foreground/50')}
                    >
                      {task.content}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      ) : (
        // The list is the projection of record; a run without one still owes
        // the lane one line, and never a guess at what it is doing.
        <div className="flex items-center gap-2 px-2 py-1.5">
          <WorkingIcon className={cn('h-3.5 w-3.5 shrink-0', workingIconClassName)} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-foreground">{t('agentSidebar.work.working')}</span>
        </div>
      )}
    </section>
  );
}
