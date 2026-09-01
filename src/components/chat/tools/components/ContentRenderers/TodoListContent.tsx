import { memo } from 'react';

import TodoList, { type TodoItem } from './TodoList';

const usableTodo = (value: unknown): value is TodoItem => {
  if (value === null || typeof value !== 'object') return false;
  const { content, status } = value as { content?: unknown; status?: unknown };
  return typeof content === 'string' && typeof status === 'string';
};

const TodoListContentView = ({ todos, isResult = false }: { todos: unknown; isResult?: boolean }) => {
  const items: TodoItem[] = [];
  if (Array.isArray(todos)) {
    for (const value of todos) {
      if (usableTodo(value)) items.push(value);
    }
  }

  return items.length === 0 ? null : <TodoList todos={items} isResult={isResult} />;
};

export const TodoListContent = memo(TodoListContentView);
