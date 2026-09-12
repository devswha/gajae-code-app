import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';

import AgentSidebarWork from './AgentSidebarWork';

function storeWith(phases: unknown[]): SessionStore {
  const messages: NormalizedMessage[] = phases.length
    ? [{
        id: 'todo-1', sessionId: 'session-1', provider: 'gjc', kind: 'tool_use',
        timestamp: '2026-09-12T00:00:00Z', toolId: 'todo-1', toolName: 'todo_write',
        toolInput: { ops: [] }, toolResult: { content: 'Updated', isError: false, toolUseResult: { phases } },
      } as unknown as NormalizedMessage]
    : [];
  return { getMessages: () => messages, subscribeSession: () => () => {} } as unknown as SessionStore;
}

function render(store: SessionStore, sessionId = 'session-1'): string {
  return renderToStaticMarkup(createElement(AgentSidebarWork, { sessionId, sessionStore: store }));
}

test('a session without a todo list and without published activity renders nothing', () => {
  assert.equal(render(storeWith([])), '');
});

test('the task rows are one compact list per phase with the shared status icon language', () => {
  const html = render(storeWith([
    {
      name: 'Implementation',
      tasks: [
        { content: 'Inspect current code', status: 'completed', notes: [] },
        { content: 'Implement sidebar work block', status: 'in_progress', notes: [] },
        { content: 'Run tests', status: 'pending', notes: [] },
      ],
    },
  ]));

  assert.match(html, /^<section aria-labelledby="agent-sidebar-work"/);
  assert.match(html, /<h3 id="agent-sidebar-work"[^>]*>agentSidebar\.work\.title<\/h3>/);
  // Phase heading, then one list item per task in the runtime's order.
  assert.match(html, /Implementation<\/p>/);
  const rows = html.match(/<li /g) ?? [];
  assert.equal(rows.length, 3);
  assert.match(html, /Inspect current code/);
  assert.match(html, /Implement sidebar work block/);
  assert.match(html, /Run tests/);
  // The statuses are readable without color, and the icons are the same ones the chat card uses.
  assert.match(html, /workspace\.tasks\.status\.completed: /);
  assert.match(html, /workspace\.tasks\.status\.in_progress: /);
  assert.match(html, /workspace\.tasks\.status\.pending: /);
  assert.match(html, /animate-spin/);
  assert.match(html, /line-through/);
  // Long text truncates inside the row; the full value stays on the title.
  assert.match(html, /title="Inspect current code"/);
  assert.match(html, /truncate/);
  // No controls: the block is a report.
  assert.doesNotMatch(html, /<button|<a /);
});
