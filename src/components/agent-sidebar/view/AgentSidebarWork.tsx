import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useSessionStatus } from '../../../contexts/SessionStatusContext';
import type { SessionStore } from '../../../stores/useSessionStore';
import { cn } from '../../../utils/cn';
import { useSessionDelegations } from '../../chat/hooks/useSessionDelegations';
import { useSessionTodos } from '../../chat/hooks/useSessionTodos';
import { TODO_STATUS_ICON } from '../../chat/view/todoStatusIcon';
import { useEgoActivity, type EgoActivitySpace } from '../hooks/useEgoActivity';

/** Keep the lane compact; the rest is counted, never listed. */
const MAX_BROWSER_ROWS = 2;

const { Icon: WorkingIcon, className: workingIconClassName } = TODO_STATUS_ICON.in_progress;

/** The runtime names agents in lowercase ('executor'); the lane shows them as labels. */
const agentLabel = (agent: string) => (agent ? agent[0].toUpperCase() + agent.slice(1) : agent);

/**
 * The page the browser is on: ego marks exactly one tab active per space, and
 * a space that has just been created has none yet.
 */
const currentPage = (space: EgoActivitySpace) => space.pages.find((page) => page.active) ?? space.pages[0];

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
 *
 * Delegations follow the same rule: the lane lists the agents the runtime
 * reports as running right now, and a settled receipt removes the row, because
 * WORK answers "what is happening" and not "what happened". A session with
 * running agents never also shows the generic "Working" row - the agents are
 * the better answer to the same question.
 *
 * Browser rows hold to the same contract from a different source: with the ego
 * backend the runtime sees only an opaque Bash call, so the state comes from
 * ego lite itself (space, page, current URL), never from tool traffic or
 * command strings. The rows exist only while the session runs and only for
 * spaces this session minted; nothing is inferred and no action is narrated.
 */
export default function AgentSidebarWork({ sessionId, sessionStore }: AgentSidebarWorkProps) {
  const { t } = useTranslation();
  const status = useSessionStatus();
  const phases = useSessionTodos(sessionStore, sessionId, Boolean(sessionId));
  const delegations = useSessionDelegations(sessionStore, sessionId, Boolean(sessionId));
  const hasTasks = phases.some((phase) => phase.tasks.length > 0);
  const agents = delegations.filter((delegation) => delegation.status === 'running');
  // Only the published activity of this very session counts; a snapshot left
  // over from another conversation must never read as this one running.
  const running = Boolean(sessionId) && status.sessionId === sessionId && status.activity.running;
  const browserSpaces = useEgoActivity(sessionId, running).spaces;

  if (!hasTasks && !running && agents.length === 0) {
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
      ) : agents.length === 0 && browserSpaces.length === 0 ? (
        // The list is the projection of record; a run without one still owes
        // the lane one line, and never a guess at what it is doing.
        <div className="flex items-center gap-2 px-2 py-1.5">
          <WorkingIcon className={cn('h-3.5 w-3.5 shrink-0', workingIconClassName)} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-foreground">{t('agentSidebar.work.working')}</span>
        </div>
      ) : null}
      {browserSpaces.length > 0 && (
        <div>
          <p className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/70">{t('agentSidebar.work.browser')}</p>
          <ul>
            {browserSpaces.slice(0, MAX_BROWSER_ROWS).map((space) => {
              const page = currentPage(space);
              const goal = space.name || t('agentSidebar.work.browserSpace', { id: space.id });
              return (
                <li key={space.id} className="flex items-start gap-2 px-2 py-1" title={`${goal}${page?.url ? ` — ${page.url}` : ''}`}>
                  <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="sr-only">{t('agentSidebar.work.browserRunning')}: </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{goal}</span>
                    {page?.url ? <span className="block truncate text-muted-foreground">{page.url}</span> : null}
                  </span>
                </li>
              );
            })}
            {browserSpaces.length > MAX_BROWSER_ROWS && (
              <li className="px-2 py-1 pl-7 text-muted-foreground">
                {t('agentSidebar.work.browserMore', { count: browserSpaces.length - MAX_BROWSER_ROWS })}
              </li>
            )}
          </ul>
        </div>
      )}
      {agents.length > 0 && (
        <div>
          <p className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/70">{t('agentSidebar.work.agents')}</p>
          <ul>
            {agents.map((agent) => (
              <li key={agent.delegationId} className="flex items-start gap-2 px-2 py-1" title={`${agent.agent}: ${agent.description}`}>
                <WorkingIcon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', workingIconClassName)} aria-hidden />
                <span className="sr-only">{t('agentSidebar.work.agentRunning')}: </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{`${agentLabel(agent.agent)} — ${agent.description}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
