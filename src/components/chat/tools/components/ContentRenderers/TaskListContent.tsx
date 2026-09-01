import React from 'react';
import { Check, Circle, Loader2 } from 'lucide-react';

interface TaskItem { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed'; owner?: string; blockedBy?: string[]; }
interface TaskListContentProps { content: string; }

const taskPattern = /#(\d+)\.?\s*(?:\[(\w+)\]\s*)?(.+?)(?:\s*\((?:owner:\s*\w+)?\))?$/;
const blockersPattern = /blockedBy:\s*\[([^\]]*)\]/;

const readTasks = (content: string): TaskItem[] => content.split('\n').flatMap((line) => {
  const fields = taskPattern.exec(line);
  if (!fields) return [];

  const blockers = blockersPattern.exec(line)?.[1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const [, id, status, subject] = fields;
  return [{ id, subject: subject.trim(), status: (status || 'pending') as TaskItem['status'], blockedBy: blockers }];
});

const presentation = {
  completed: {
    icon: <Check className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />,
    textClass: 'line-through text-muted-foreground',
    badgeClass: 'border-border bg-muted/30 text-muted-foreground',
  },
  in_progress: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />,
    textClass: 'text-foreground',
    badgeClass: 'border-border bg-muted/30 text-foreground',
  },
  pending: {
    icon: <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />,
    textClass: 'text-muted-foreground',
    badgeClass: 'border-border bg-muted/30 text-muted-foreground',
  },
};

export const TaskListContent: React.FC<TaskListContentProps> = ({ content }) => {
  const tasks = readTasks(content);
  if (tasks.length === 0) return <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">{content}</pre>;

  const completedCount = tasks.reduce((total, task) => total + Number(task.status === 'completed'), 0);
  const progress = (completedCount / tasks.length) * 100;

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{completedCount}/{tasks.length} completed</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="space-y-px">
        {tasks.map((task) => {
          const status = presentation[task.status] || presentation.pending;
          return (
            <div key={task.id} className="group flex items-center gap-1.5 py-0.5">
              <span className="shrink-0">{status.icon}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">#{task.id}</span>
              <span className={`flex-1 truncate text-xs ${status.textClass}`}>{task.subject}</span>
              <span className={`shrink-0 rounded border px-1 py-px text-[10px] ${status.badgeClass}`}>{task.status.replace('_', ' ')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
