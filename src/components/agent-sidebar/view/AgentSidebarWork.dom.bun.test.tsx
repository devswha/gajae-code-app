import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { type ReactNode } from 'react';

import { SessionStatusProvider, usePublishSessionStatus } from '../../../contexts/SessionStatusContext';
import { EMPTY_SESSION_STATUS, type SessionStatusSnapshot } from '../../../contexts/sessionStatusSnapshot';
import enCommon from '../../../i18n/locales/en/common.json';
import koCommon from '../../../i18n/locales/ko/common.json';
import type { NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';
import type { SessionTodoPhase } from '../../chat/hooks/useSessionTodos';

import AgentSidebarWork from './AgentSidebarWork';

afterEach(cleanup);

const plan: SessionTodoPhase[] = [{
  name: 'Implementation',
  tasks: [
    { content: 'Inspect current code', status: 'completed', notes: [] },
    { content: 'Implement sidebar work block', status: 'in_progress', notes: ['Keep it compact.'] },
    { content: 'Run tests', status: 'pending', notes: [] },
    { content: 'Support a per-phase fold', status: 'abandoned', notes: [] },
  ],
}];

function createStore() {
  const messages = new Map<string, NormalizedMessage[]>();
  const listeners = new Map<string, Set<() => void>>();
  const empty: NormalizedMessage[] = [];
  let sequence = 0;
  const store = {
    getMessages: (id: string) => messages.get(id) ?? empty,
    subscribeSession: (id: string, listener: () => void) => {
      const subscriptions = listeners.get(id) ?? new Set();
      listeners.set(id, subscriptions);
      subscriptions.add(listener);
      return () => { subscriptions.delete(listener); };
    },
  } satisfies Pick<SessionStore, 'getMessages' | 'subscribeSession'>;
  return {
    store: store as SessionStore,
    listeners: (id: string) => listeners.get(id)?.size ?? 0,
    /** Publishes phases the way the runtime does: a structured todo_write result in the message window. */
    publish: (id: string, phases: SessionTodoPhase[]) => {
      sequence += 1;
      messages.set(id, [{
        id: `todo-${sequence}`, sessionId: id, provider: 'gjc', kind: 'tool_use',
        timestamp: '2026-09-12T00:00:00Z', toolId: `todo-${sequence}`, toolName: 'todo_write',
        toolInput: { ops: [] }, toolResult: { content: 'Updated', isError: false, toolUseResult: { phases } },
      } as unknown as NormalizedMessage]);
      listeners.get(id)?.forEach((listener) => listener());
    },
    /** Appends the delegation tool's structured result, the way a started delegation lands. */
    delegate: (id: string, subagents: Array<Record<string, unknown>>) => {
      sequence += 1;
      messages.set(id, [...(messages.get(id) ?? []), {
        id: `task-${sequence}`, sessionId: id, provider: 'gjc', kind: 'tool_use',
        timestamp: '2026-09-12T00:01:00Z', toolId: `task-${sequence}`, toolName: 'task',
        toolInput: {}, toolResult: { content: 'Started', isError: false, toolUseResult: { subagents } },
      } as unknown as NormalizedMessage]);
      listeners.get(id)?.forEach((listener) => listener());
    },
    /** Appends a started delegation the way the live stream delivers it: call row, then a standalone result row. */
    delegateLive: (id: string, subagents: Array<Record<string, unknown>>) => {
      sequence += 1;
      messages.set(id, [...(messages.get(id) ?? []),
        {
          id: `task-${sequence}`, sessionId: id, provider: 'gjc', kind: 'tool_use',
          timestamp: '2026-09-12T00:01:00Z', toolId: `task-${sequence}`, toolName: 'task',
          toolInput: {},
        } as unknown as NormalizedMessage,
        {
          id: `result-${sequence}`, sessionId: id, provider: 'gjc', kind: 'tool_result',
          timestamp: '2026-09-12T00:01:01Z', toolId: `task-${sequence}`,
          content: 'Started', isError: false, isFinal: true, toolUseResult: { subagents },
        } as unknown as NormalizedMessage,
      ]);
      listeners.get(id)?.forEach((listener) => listener());
    },
    /** Appends the authoritative settlement row the executor emits per receipt. */
    settle: (id: string, delegation: Record<string, unknown>) => {
      sequence += 1;
      messages.set(id, [...(messages.get(id) ?? []), {
        id: `settle-${sequence}`, sessionId: id, provider: 'gjc', kind: 'delegation_updated',
        timestamp: '2026-09-12T00:02:00Z', delegation,
      } as unknown as NormalizedMessage]);
      listeners.get(id)?.forEach((listener) => listener());
    },
  };
}

const agent = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1', status: 'running', agent: 'executor', description: 'Wire the WORK lane', ...overrides,
});

function running(sessionId: string): SessionStatusSnapshot {
  return { ...EMPTY_SESSION_STATUS, sessionId, activity: { running: true, statusText: null, queued: 0 } };
}

function Publisher({ snapshot, children }: { snapshot: SessionStatusSnapshot; children?: ReactNode }) {
  usePublishSessionStatus(snapshot);
  return children;
}

async function setup(lng = 'en') {
  const i18n = createInstance();
  await i18n.init({ lng, fallbackLng: 'en', resources: { en: { translation: enCommon }, ko: { translation: koCommon } }, interpolation: { escapeValue: false } });
  const state = createStore();
  const ui = (sessionId: string | undefined, snapshot: SessionStatusSnapshot = EMPTY_SESSION_STATUS) => (
    <I18nextProvider i18n={i18n}>
      <SessionStatusProvider>
        <Publisher snapshot={snapshot}>
          <AgentSidebarWork sessionId={sessionId} sessionStore={state.store} />
        </Publisher>
      </SessionStatusProvider>
    </I18nextProvider>
  );
  return { ...state, ui };
}

const section = () => screen.getByRole('region', { name: 'Work' });

test('an idle session without a todo list renders no WORK block at all', async () => {
  const state = await setup();
  const view = render(state.ui('session-1'));
  assert.equal(view.container.innerHTML, '');
  // No "Idle" placeholder either: absence is the idle state.
  assert.equal(screen.queryByText(/idle/i), null);
});

test('a running session without a todo list shows the minimal Working row only', async () => {
  const state = await setup();
  render(state.ui('session-1', running('session-1')));

  const region = section();
  assert.ok(within(region).getByText('Working'));
  assert.equal(within(region).queryByRole('list'), null);
  assert.equal(within(region).queryByText('Idle'), null);
  // The row carries the app's in-progress convention: the spinning primary icon.
  const icon = within(region).getByText('Working').previousElementSibling!;
  assert.match(icon.getAttribute('class')!, /animate-spin/);
  assert.match(icon.getAttribute('class')!, /text-primary/);
});

test('a session whose published activity belongs to another conversation is not running', async () => {
  const state = await setup();
  const view = render(state.ui('session-1', running('session-2')));
  assert.equal(view.container.innerHTML, '');
});

test('a running session with todos lists the tasks and never adds a redundant Working row', async () => {
  const state = await setup();
  state.publish('session-1', plan);
  render(state.ui('session-1', running('session-1')));

  const region = section();
  const rows = within(region).getAllByRole('listitem');
  assert.equal(rows.length, 4);
  assert.match(rows[0].textContent!, /Inspect current code/);
  assert.match(rows[1].textContent!, /Implement sidebar work block/);
  assert.match(rows[2].textContent!, /Run tests/);
  assert.equal(within(region).queryByText('Working'), null);
});

test('an idle session with todos keeps the task rows visible', async () => {
  const state = await setup();
  state.publish('session-1', plan);
  render(state.ui('session-1'));

  const rows = within(section()).getAllByRole('listitem');
  assert.equal(rows.length, 4);
  assert.equal(within(section()).queryByText('Working'), null);
});

test('structured todo_write phases render with their phase names, statuses and non-color labels', async () => {
  const state = await setup();
  state.publish('session-1', [
    { name: 'Audit', tasks: [{ content: 'Read the audit', status: 'completed', notes: [] }] },
    { name: '', tasks: [{ content: 'Unnamed phase task', status: 'pending', notes: [] }] },
  ]);
  render(state.ui('session-1'));

  const region = section();
  assert.ok(within(region).getByText('Audit'));
  const rows = within(region).getAllByRole('listitem');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent!, /Completed:.*Read the audit/);
  assert.match(rows[1].textContent!, /Pending:.*Unnamed phase task/);
});

test('the in-progress task is visually distinguishable from the quiet rows', async () => {
  const state = await setup();
  state.publish('session-1', plan);
  render(state.ui('session-1'));

  const current = within(section()).getByText('Implement sidebar work block').closest('li')!;
  assert.match(current.textContent!, /In progress:/);
  assert.match(current.querySelector('svg')!.getAttribute('class')!, /animate-spin/);
  assert.match(current.querySelector('svg')!.getAttribute('class')!, /text-primary/);
  assert.doesNotMatch(current.querySelector('span:last-child')!.getAttribute('class')!, /line-through/);
});

test('completed rows are subdued and struck; pending rows stay quiet and unstruck', async () => {
  const state = await setup();
  state.publish('session-1', plan);
  render(state.ui('session-1'));

  const completed = within(section()).getByText('Inspect current code').closest('li')!;
  assert.match(completed.querySelector('span:last-child')!.getAttribute('class')!, /line-through/);
  assert.match(completed.querySelector('span:last-child')!.getAttribute('class')!, /text-muted-foreground/);

  const pending = within(section()).getByText('Run tests').closest('li')!;
  assert.doesNotMatch(pending.querySelector('span:last-child')!.getAttribute('class')!, /line-through/);
  assert.match(pending.querySelector('svg')!.getAttribute('class')!, /text-muted-foreground\/60/);
});

test('an abandoned task uses the subdued abandoned convention', async () => {
  const state = await setup();
  state.publish('session-1', plan);
  render(state.ui('session-1'));

  const abandoned = within(section()).getByText('Support a per-phase fold').closest('li')!;
  assert.match(abandoned.textContent!, /Abandoned:/);
  assert.match(abandoned.querySelector('span:last-child')!.getAttribute('class')!, /line-through/);
});

test('an all-completed snapshot stays truthful: every row completed, nothing invented', async () => {
  const state = await setup();
  state.publish('session-1', [{ name: '', tasks: [
    { content: 'Inspect current code', status: 'completed', notes: [] },
    { content: 'Implement sidebar work block', status: 'completed', notes: [] },
  ] }]);
  // Even while the run continues: the list is the projection of record.
  render(state.ui('session-1', running('session-1')));

  const region = section();
  const rows = within(region).getAllByRole('listitem');
  assert.equal(rows.length, 2);
  rows.forEach((row) => assert.match(row.textContent!, /Completed:/));
  assert.equal(within(region).queryByText('Working'), null);
  assert.equal(within(region).queryByText(/In progress:/), null);
});

test('long task text truncates to one compact line and keeps the full value on the row', async () => {
  const state = await setup();
  const longTask = `${'Inspect the very long path/'.repeat(20)}file.ts`;
  state.publish('session-1', [{ name: '', tasks: [{ content: longTask, status: 'in_progress', notes: [] }] }]);
  render(state.ui('session-1'));

  const row = within(section()).getByText(longTask).closest('li')!;
  assert.equal(row.getAttribute('title'), longTask);
  assert.match(row.querySelector('span:last-child')!.getAttribute('class')!, /truncate/);
  // The notes stay in the chat's task card; the compact block lists tasks only.
  assert.equal(within(section()).queryByText('Keep it compact.'), null);
});

test('the block stays a projection: no controls, no guessed state, no agent, IRC or browser surface', async () => {
  const state = await setup();
  state.publish('session-1', plan);
  render(state.ui('session-1', running('session-1')));

  const region = section();
  assert.equal(within(region).queryByRole('button'), null);
  assert.equal(within(region).queryByRole('link'), null);
  assert.equal(within(region).getAllByRole('heading').length, 1);
  // No status is guessed beyond the task statuses the runtime wrote.
  assert.equal(within(region).queryByText(/blocked|stalled|waiting/i), null);
  assert.doesNotMatch(region.textContent!, /agent|subagent|irc|aside|browser|tab|screenshot/i);
});

test('the list follows the session window live and unsubscribes when the session goes away', async () => {
  const state = await setup();
  state.publish('session-1', plan);
  const view = render(state.ui('session-1'));

  const next: SessionTodoPhase[] = [{ name: '', tasks: [
    { content: 'Implement sidebar work block', status: 'completed', notes: [] },
    { content: 'Run tests', status: 'in_progress', notes: [] },
  ] }];
  act(() => state.publish('session-1', next));
  assert.ok(within(section()).getByText('Run tests'));
  assert.equal(within(section()).queryByText('Inspect current code'), null);

  view.rerender(state.ui(undefined));
  assert.equal(view.container.innerHTML, '');
  assert.equal(state.listeners('session-1'), 0);
});

test('an idle session with neither todos nor agents still renders nothing', async () => {
  const state = await setup();
  state.settle('session-1', { delegationId: 'd1', status: 'completed', agent: 'executor', description: 'Wire the WORK lane' });
  const view = render(state.ui('session-1'));
  assert.equal(view.container.innerHTML, '');
});

test('a live stream result row settles onto its call and lists the agent without a reload', async () => {
  const state = await setup();
  state.delegateLive('session-1', [agent()]);
  render(state.ui('session-1', running('session-1')));

  const region = section();
  assert.ok(within(region).getByText('Executor — Wire the WORK lane'));
  assert.equal(within(region).queryByText('Working'), null);

  // The run itself is still active, so the lane falls back to its generic row.
  act(() => state.settle('session-1', { delegationId: 'd1', status: 'completed', agent: 'executor', description: 'Wire the WORK lane' }));
  assert.equal(within(section()).queryByText('Executor — Wire the WORK lane'), null);
  assert.ok(within(section()).getByText('Working'));
});

test('a running agent replaces the generic Working row: the agent is the better answer', async () => {
  const state = await setup();
  state.delegate('session-1', [agent()]);
  render(state.ui('session-1', running('session-1')));

  const region = section();
  assert.ok(within(region).getByText('Agents'));
  assert.ok(within(region).getByText('Executor — Wire the WORK lane'));
  assert.equal(within(region).queryByText('Working'), null);
  const row = within(region).getByText('Executor — Wire the WORK lane').closest('li')!;
  assert.match(row.textContent!, /Running:/);
  assert.match(row.querySelector('svg')!.getAttribute('class')!, /animate-spin/);
});

test('a session with todos and a running agent shows both, tasks first', async () => {
  const state = await setup();
  state.publish('session-1', plan);
  state.delegate('session-1', [agent()]);
  render(state.ui('session-1', running('session-1')));

  const region = section();
  const rows = within(region).getAllByRole('listitem');
  assert.equal(rows.length, 5);
  assert.match(rows[0].textContent!, /Inspect current code/);
  assert.match(rows[4].textContent!, /Executor — Wire the WORK lane/);
  assert.equal(within(region).queryByText('Working'), null);
});

test('every active agent is listed; the concurrency limit keeps the block compact', async () => {
  const state = await setup();
  state.delegate('session-1', [
    agent({ id: 'd1', agent: 'planner', description: 'Sequence the work' }),
    agent({ id: 'd2', agent: 'executor', description: 'Server lane' }),
    agent({ id: 'd3', agent: 'critic', description: 'Review the plan' }),
  ]);
  render(state.ui('session-1'));

  const rows = within(section()).getAllByRole('listitem');
  assert.deepEqual(rows.map((row) => row.querySelector('span:last-child')!.textContent), [
    'Planner — Sequence the work', 'Executor — Server lane', 'Critic — Review the plan',
  ]);
});

test('a settled agent leaves the lane as soon as its receipt lands', async () => {
  const state = await setup();
  state.delegate('session-1', [agent({ id: 'd1' }), agent({ id: 'd2', agent: 'planner', description: 'Sequence the work' })]);
  render(state.ui('session-1'));
  assert.equal(within(section()).getAllByRole('listitem').length, 2);

  act(() => state.settle('session-1', { delegationId: 'd1', status: 'completed', agent: 'executor', description: 'Wire the WORK lane' }));
  const rows = within(section()).getAllByRole('listitem');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent!, /Planner — Sequence the work/);

  // The last agent settling empties the lane entirely: WORK is now-only.
  act(() => state.settle('session-1', { delegationId: 'd2', status: 'cancelled', agent: 'planner', description: 'Sequence the work' }));
  assert.equal(screen.queryByRole('region', { name: 'Work' }), null);
});

test('failed and cancelled agents render nothing at all: the lane never doubles as a report', async () => {
  const state = await setup();
  state.delegate('session-1', [agent({ id: 'd1' }), agent({ id: 'd2', agent: 'planner', description: 'Sequence the work' })]);
  state.settle('session-1', { delegationId: 'd1', status: 'failed', agent: 'executor', description: 'Wire the WORK lane' });
  state.settle('session-1', { delegationId: 'd2', status: 'cancelled', agent: 'planner', description: 'Sequence the work' });
  state.publish('session-1', plan);
  state.delegate('session-1', [agent({ id: 'd1', status: 'failed' })]);
  render(state.ui('session-1'));

  const region = section();
  assert.equal(within(region).queryByText('Agents'), null);
  assert.doesNotMatch(region.textContent!, /Executor|Planner|failed|cancelled/i);
  assert.equal(within(region).getAllByRole('listitem').length, 4);
});

test('a long agent description truncates to one line and keeps the full value on the row', async () => {
  const state = await setup();
  const description = `${'Implement the very long delegation description/'.repeat(20)}done`;
  state.delegate('session-1', [agent({ description })]);
  render(state.ui('session-1'));

  const row = within(section()).getByText(`Executor — ${description}`).closest('li')!;
  assert.equal(row.getAttribute('title'), `executor: ${description}`);
  assert.match(row.querySelector('span:last-child')!.getAttribute('class')!, /truncate/);
});

test('agents published for another conversation never appear in this one', async () => {
  const state = await setup();
  state.delegate('session-2', [agent({ description: 'Another conversation' })]);
  const view = render(state.ui('session-1'));
  assert.equal(view.container.innerHTML, '');

  view.rerender(state.ui('session-2'));
  assert.ok(within(section()).getByText('Executor — Another conversation'));
});

test('Korean headings and status labels come from the same locale data as the chat card', async () => {
  const state = await setup('ko');
  state.publish('session-1', [{ name: '구현', tasks: [{ content: '블록 구현', status: 'in_progress', notes: [] }] }]);
  render(state.ui('session-1'));

  const region = screen.getByRole('region', { name: '작업' });
  assert.ok(within(region).getByText('구현'));
  assert.match(within(region).getByText('블록 구현').closest('li')!.textContent!, /진행 중:/);
  assert.equal(within(region).queryByText('작업 중'), null);
});
