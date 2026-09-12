import { CircleCheck, CircleDashed, CircleX, LoaderCircle, type LucideIcon } from 'lucide-react';

import type { SessionTodoStatus } from '../hooks/useSessionTodos';

/**
 * The one icon language for todo statuses, shared by the chat's task card and
 * the agent sidebar's WORK block so a task reads the same in both places.
 * The map carries color and motion only; each surface sizes and aligns the
 * icon itself.
 */
export const TODO_STATUS_ICON: Record<SessionTodoStatus, { Icon: LucideIcon; className: string }> = {
  pending: { Icon: CircleDashed, className: 'text-muted-foreground/60' },
  in_progress: { Icon: LoaderCircle, className: 'animate-spin text-primary' },
  completed: { Icon: CircleCheck, className: 'text-muted-foreground' },
  abandoned: { Icon: CircleX, className: 'text-muted-foreground/50' },
};
