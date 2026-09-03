import { Circle, CircleDashed, CircleX, ListTodo, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ScrollArea } from '../../../shared/view/ui/ScrollArea';
import type { SessionStore } from '../../../stores/useSessionStore';
import { cn } from '../../../utils/cn';
import { useSessionTodos, type SessionTodoStatus } from '../hooks/useSessionTodos';

const STATUS_ICON: Record<SessionTodoStatus, { Icon: typeof Circle; className: string }> = {
  pending: { Icon: CircleDashed, className: 'text-muted-foreground/60' },
  in_progress: { Icon: LoaderCircle, className: 'animate-spin text-primary' },
  completed: { Icon: Circle, className: 'text-muted-foreground' },
  abandoned: { Icon: CircleX, className: 'text-muted-foreground/50' },
};

type WorkspaceTasksTabProps = {
  readonly sessionId?: string;
  readonly sessionStore: SessionStore;
  readonly active: boolean;
};

/**
 * The session's todo list, live: the runtime writes it through todo_write and
 * the chat shows only each collapsed call, so this tab is where the current
 * state is actually visible while a turn plans and works.
 */
export default function WorkspaceTasksTab({ sessionId, sessionStore, active }: WorkspaceTasksTabProps) {
  const { t } = useTranslation();
  const phases = useSessionTodos(sessionStore, sessionId, active);
  const total = phases.reduce((count, phase) => count + phase.tasks.length, 0);
  const done = phases.reduce((count, phase) => count + phase.tasks.filter((task) => task.status === 'completed').length, 0);

  if (!sessionId || phases.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ListTodo className="size-5 text-muted-foreground/50" aria-hidden />
        <p className="text-sm text-muted-foreground">{t('workspace.tasks.empty')}</p>
        <p className="max-w-56 text-xs text-muted-foreground/70">{t('workspace.tasks.emptyHint')}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <section aria-label={t('workspace.tabs.tasks')} className="space-y-3 p-3">
        <p className="text-xs text-muted-foreground" role="status">
          {t('workspace.tasks.progress', { done, total })}
        </p>
        {phases.map((phase) => (
          <div key={phase.name || 'default'} className="space-y-1">
            {phase.name && (
              <h4 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{phase.name}</h4>
            )}
            <ul className="space-y-0.5">
              {phase.tasks.map((task) => {
                const { Icon, className } = STATUS_ICON[task.status];
                return (
                  <li key={task.content} className="rounded-md px-2 py-1.5 hover:bg-muted/40">
                    <div className="flex items-start gap-2">
                      <Icon className={cn('mt-0.5 size-3.5 shrink-0', className)} aria-hidden />
                      <span className={cn(
                        'min-w-0 flex-1 text-sm wrap-break-word',
                        (task.status === 'completed' || task.status === 'abandoned') && 'text-muted-foreground line-through decoration-muted-foreground/50',
                      )}
                      >
                        {task.content}
                      </span>
                    </div>
                    {task.status === 'in_progress' && task.notes.map((note) => (
                      <p key={note} className="mt-1 ml-5.5 text-xs whitespace-pre-wrap text-muted-foreground">{note}</p>
                    ))}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </ScrollArea>
  );
}
