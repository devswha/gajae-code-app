import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import type { NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';
import { useSessionAttentionStore } from '../../../stores/useSessionAttentionStore';
import type { AgentSidebarProps } from '../../agent-sidebar/view/AgentSidebar';
import type { WorkspacePanelProps } from '../../workspace/view/WorkspacePanel';

import MainContentRightRail, { type MainContentRightRailProps } from './MainContentRightRail';

const workspace: WorkspacePanelProps = {
  sessionStore: {} as SessionStore,
  tab: 'status',
  width: 420,
  expanded: false,
  isMobile: false,
  resizeHandleRef: { current: null },
  onTabChange: () => undefined,
  onResizeStart: () => undefined,
  onResizeKeyDown: () => undefined,
  onToggleExpand: () => undefined,
  onClose: () => undefined,
};

const noMessages: NormalizedMessage[] = [];

const agentSidebar: AgentSidebarProps = {
  isMobile: false,
  projectId: 'project-alpha',
  projectPath: '/work/alpha',
  sessionId: 'session-alpha',
  onClose: () => undefined,
  // The WORK block reads the todo fold through the store's message window; the
  // empty window must be one stable reference, as the real store guarantees.
  sessionStore: { getMessages: () => noMessages, subscribeSession: () => () => {} } as unknown as SessionStore,
};

const props = (overrides: Partial<MainContentRightRailProps>): MainContentRightRailProps => ({
  agentSidebarV2: false,
  open: true,
  workspace,
  agentSidebar,
  ...overrides,
});

const originalFetch = globalThis.fetch;
let requests: string[] = [];

beforeEach(() => {
  useSessionAttentionStore.setState({ pendingInput: {} });
  // Both rails ask the server for the same git summary; the rail is what is under test.
  requests = [];
  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ branch: 'main', modified: ['a.ts'], added: [], deleted: [], untracked: [], staged: [] }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  useSessionAttentionStore.setState({ pendingInput: {} });
  globalThis.fetch = originalFetch;
});

test('with the experiment off the rail is the legacy workspace panel alone', async () => {
  useSessionAttentionStore.getState().addPendingInput('session-alpha', 'approval-1');
  render(createElement(MainContentRightRail, props({ agentSidebarV2: false })));

  await screen.findByRole('tablist');
  assert.ok(screen.getByRole('complementary', { name: 'workspace.title' }));
  assert.equal(screen.queryByRole('complementary', { name: 'agentSidebar.title' }), null);
  // The legacy panel keeps its own Status tab sections; the Environment block is the new rail's.
  await screen.findByText('workspace.statusTab.git');
  assert.equal(screen.queryByRole('region', { name: 'agentSidebar.environment.title' }), null);
  assert.equal(screen.queryByRole('region', { name: 'agentSidebar.work.title' }), null);
  assert.equal(screen.queryByRole('region', { name: 'agentSidebar.actionRequired.title' }), null);
});

test('with the experiment on the rail is the compact context panel alone, with the environment as its body', async () => {
  useSessionAttentionStore.getState().addPendingInput('session-alpha', 'approval-1');
  render(createElement(MainContentRightRail, props({ agentSidebarV2: true })));

  const lane = await screen.findByRole('complementary', { name: 'agentSidebar.title' });
  assert.equal(screen.queryByRole('tablist'), null);
  assert.equal(screen.queryByRole('complementary', { name: 'workspace.title' }), null);
  // No resize handle and no rail header: the panel is a card in a lane, not a second sidebar.
  assert.equal(screen.queryByRole('separator'), null);
  assert.equal(screen.queryByRole('heading', { level: 2 }), null);
  assert.equal(lane.getAttribute('style'), null);

  assert.ok(screen.getByRole('region', { name: 'agentSidebar.environment.title' }));
  assert.ok(screen.getByRole('region', { name: 'agentSidebar.actionRequired.title' }));
  await screen.findByText('main');
  // The section is fed by the same endpoint the legacy Status tab already uses; nothing new is needed.
  assert.deepEqual(requests, ['/api/git/status?project=project-alpha&sessionId=session-alpha']);
});

test('a closed rail renders nothing, whichever rail is selected', async () => {
  const legacy = render(createElement(MainContentRightRail, props({ agentSidebarV2: false, open: false })));
  assert.equal(legacy.container.innerHTML, '');

  const experimental = render(createElement(MainContentRightRail, props({ agentSidebarV2: true, open: false })));
  assert.equal(experimental.container.innerHTML, '');
});

test('flipping the experiment on a mounted rail swaps rails without ever showing both', async () => {
  const view = render(createElement(MainContentRightRail, props({ agentSidebarV2: false })));

  await screen.findByRole('tablist');

  view.rerender(createElement(MainContentRightRail, props({ agentSidebarV2: true })));

  await screen.findByRole('complementary', { name: 'agentSidebar.title' });
  assert.equal(screen.queryByRole('tablist'), null);
  assert.equal(screen.queryByRole('complementary', { name: 'workspace.title' }), null);
});
