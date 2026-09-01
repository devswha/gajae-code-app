import { memo } from 'react';

import { Queue, QueueItem, QueueItemContent, QueueItemIndicator } from '../../../../../shared/view/ui';
import type { QueueItemStatus } from '../../../../../shared/view/ui';

export type TodoItem = { id?: string; content: string; status: string; priority?: string; activeForm?: string; };

const queueStatusFor = (status: string): QueueItemStatus => {
  const recognizedStatuses: Record<string, QueueItemStatus> = {
    completed: 'completed',
    in_progress: 'in_progress',
  };
  return recognizedStatuses[status] ?? 'pending';
};

const TodoList = memo(({ todos, isResult = false }: { todos: TodoItem[]; isResult?: boolean }) => {
  if (todos.length === 0) return null;

  const itemWord = todos.length === 1 ? 'item' : 'items';
  return (
    <div>
      {isResult && <div className="mb-1.5 text-xs font-medium text-muted-foreground">Todo List ({todos.length} {itemWord})</div>}
      <Queue>
        {todos.map((todo, index) => (
          <QueueItem key={todo.id ?? `${todo.content}-${index}`} status={queueStatusFor(todo.status)}>
            <QueueItemIndicator />
            <QueueItemContent>{todo.content}</QueueItemContent>
          </QueueItem>
        ))}
      </Queue>
    </div>
  );
});

TodoList.displayName = 'TodoList';

export default TodoList;
