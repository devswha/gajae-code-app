import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';

import type { NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';
import { AGENT_SIDEBAR_STORAGE_KEY, DEFAULT_AGENT_SIDEBAR_WIDTH } from '../agentSidebarState';
import { useAgentSidebar } from '../hooks/useAgentSidebar';

import AgentSidebar from './AgentSidebar';

const originalFetch = globalThis.fetch;
let requests: string[] = [];

function seed(state: { open: boolean; width: number }) {
  localStorage.setItem(AGENT_SIDEBAR_STORAGE_KEY, JSON.stringify(state));
}

function persisted(): { open: boolean; width: number } {
  return JSON.parse(localStorage.getItem(AGENT_SIDEBAR_STORAGE_KEY) ?? 'null');
}

/** A session store whose window can carry a structured todo_write result, like the chat's. */
function createStore(phases: unknown[] = []) {
  const messages: NormalizedMessage[] = phases.length
    ? [{
        id: 'todo-1', sessionId: 'session-1', provider: 'gjc', kind: 'tool_use',
        timestamp: '2026-09-12T00:00:00Z', toolId: 'todo-1', toolName: 'todo_write',
        toolInput: { ops: [] }, toolResult: { content: 'Updated', isError: false, toolUseResult: { phases } },
      } as unknown as NormalizedMessage]
    : [];
  return { getMessages: () => messages, subscribeSession: () => () => {} } as unknown as SessionStore;
}

function Harness({ mobile = false, sessionStore = createStore() }: { mobile?: boolean; sessionStore?: SessionStore }) {
  const sidebar = useAgentSidebar();
  return createElement('div', null,
    createElement('button', { onClick: sidebar.open }, 'Open'),
    createElement('button', { onClick: sidebar.toggle }, 'Toggle'),
    sidebar.isOpen
      ? createElement(AgentSidebar, {
        isMobile: mobile,
        projectId: 'project-alpha',
        projectPath: '/work/alpha',
        sessionId: 'session-1',
        onClose: sidebar.close,
        sessionStore,
      })
      : null,
  );
}

const lane = () => screen.getByRole('complementary', { name: 'agentSidebar.title' });

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ branch: 'main', modified: ['a.ts'], added: [], deleted: [], untracked: ['b.md'], staged: [] }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(AGENT_SIDEBAR_STORAGE_KEY);
  globalThis.fetch = originalFetch;
});

test('the sidebar starts closed and opening it persists the open state', async () => {
  render(createElement(Harness));

  assert.equal(screen.queryByRole('complementary'), null);

  fireEvent.click(screen.getByText('Open'));

  assert.ok(lane());
  assert.deepEqual(persisted(), { open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH });
  await within(lane()).findByText('main');
});

test('the header toggle opens and closes the sidebar in turn', async () => {
  render(createElement(Harness));

  fireEvent.click(screen.getByText('Toggle'));
  assert.ok(lane());
  assert.equal(persisted().open, true);
  await within(lane()).findByText('main');

  fireEvent.click(screen.getByText('Toggle'));
  assert.equal(screen.queryByRole('complementary'), null);
  assert.equal(persisted().open, false);
});

test('a width saved by the old resizable rail is kept as it was, untouched by opening and closing', async () => {
  seed({ open: false, width: 640 });
  render(createElement(Harness));

  fireEvent.click(screen.getByText('Toggle'));
  await within(lane()).findByText('main');
  fireEvent.click(screen.getByText('Toggle'));

  assert.deepEqual(persisted(), { open: false, width: 640 });
});

test('the desktop lane holds the environment card with the existing git summary and its refresh', async () => {
  seed({ open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH });
  render(createElement(Harness));

  const region = within(lane()).getByRole('region', { name: 'agentSidebar.environment.title' });
  await within(region).findByText('main');
  assert.ok(within(region).getByText('2'));
  assert.ok(within(region).getByTitle('/work/alpha'));
  assert.deepEqual(requests, ['/api/git/status?project=project-alpha&sessionId=session-1']);

  // No header, no close, no separator: the refresh is the lane's only control.
  assert.equal(within(lane()).queryByRole('heading', { level: 2 }), null);
  assert.equal(screen.queryByRole('separator'), null);
  const buttons = within(lane()).getAllByRole('button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].getAttribute('aria-label'), 'agentSidebar.environment.refresh');

  fireEvent.click(buttons[0]);
  await waitFor(() => assert.equal(requests.length, 2));
});

test('the desktop lane sets no inline width and carries no rail chrome', async () => {
  seed({ open: true, width: 1_200 });
  render(createElement(Harness));

  const element = lane();
  assert.equal(element.getAttribute('style'), null);
  assert.doesNotMatch(element.className, /border-l|bg-sidebar|inset-y-0/);
  assert.match(element.className, /\bw-64\b.*\blg:w-80\b/);
  await within(element).findByText('main');
});

test('the WORK block appears under the environment in the same card when the session has todos', async () => {
  seed({ open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH });
  render(createElement(Harness, {
    sessionStore: createStore([{ name: '', tasks: [
      { content: 'Inspect current code', status: 'completed', notes: [] },
      { content: 'Implement sidebar work block', status: 'in_progress', notes: [] },
    ] }]),
  }));

  const card = within(lane()).getByRole('region', { name: 'agentSidebar.environment.title' }).parentElement!;
  const work = within(card).getByRole('region', { name: 'agentSidebar.work.title' });
  assert.match(work.className, /border-t/);
  assert.ok(within(work).getByText('Implement sidebar work block'));
  assert.equal(within(work).queryByText('agentSidebar.work.working'), null);
});

test('an idle session without todos leaves the card to the environment alone', async () => {
  seed({ open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH });
  render(createElement(Harness));

  await within(lane()).findByText('main');
  assert.equal(within(lane()).queryByRole('region', { name: 'agentSidebar.work.title' }), null);
});

test('the mobile drawer is dismissed by its backdrop and never touches the saved width', async () => {
  seed({ open: true, width: 1_200 });
  render(createElement(Harness, { mobile: true }));

  const drawer = lane();
  assert.match(drawer.className, /fixed inset-y-0 right-0/);
  assert.ok(within(drawer).getByRole('heading', { level: 2, name: 'agentSidebar.title' }));
  assert.ok(within(drawer).getByRole('region', { name: 'agentSidebar.environment.title' }));
  assert.equal(screen.queryByRole('separator'), null);
  await within(drawer).findByText('main');

  const backdrop = screen.getAllByRole('button', { name: 'agentSidebar.close' })[0];
  assert.match(backdrop.className, /fixed inset-0/);
  fireEvent.click(backdrop);

  assert.equal(screen.queryByRole('complementary'), null);
  assert.deepEqual(persisted(), { open: false, width: 1_200 });
});

test('the mobile close button dismisses the drawer', async () => {
  seed({ open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH });
  render(createElement(Harness, { mobile: true }));

  await within(lane()).findByText('main');
  const closeButton = within(lane()).getByRole('button', { name: 'agentSidebar.close' });
  fireEvent.click(closeButton);

  assert.equal(screen.queryByRole('complementary'), null);
  assert.equal(persisted().open, false);
});
