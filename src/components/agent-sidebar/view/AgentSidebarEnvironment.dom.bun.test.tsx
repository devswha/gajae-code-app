import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import { SessionStatusProvider, usePublishSessionStatus } from '../../../contexts/SessionStatusContext';
import { EMPTY_SESSION_STATUS, type SessionStatusSnapshot } from '../../../contexts/sessionStatusSnapshot';

import AgentSidebarEnvironment, { type AgentSidebarEnvironmentProps } from './AgentSidebarEnvironment';

const originalFetch = globalThis.fetch;
let requests: string[] = [];

/** The shape `/api/git/status` answers with; the arrays are file paths. */
const status = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  branch: 'main',
  hasCommits: true,
  modified: ['src/a.ts', 'src/b.ts'],
  added: ['src/c.ts'],
  deleted: [],
  untracked: ['notes.md'],
  staged: ['src/c.ts'],
  ...overrides,
});

function answer(body: string | (() => Response)) {
  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    return typeof body === 'function' ? body() : new Response(body, { status: 200 });
  }) as typeof fetch;
}

function environment(overrides: Partial<AgentSidebarEnvironmentProps> = {}) {
  return createElement(AgentSidebarEnvironment, {
    projectId: 'project-alpha',
    projectPath: '/work/alpha',
    sessionId: 'session-1',
    ...overrides,
  });
}

function Publisher({ snapshot, children }: { snapshot: SessionStatusSnapshot; children?: ReactNode }) {
  usePublishSessionStatus(snapshot);
  return children;
}

const section = () => screen.getByRole('region', { name: 'agentSidebar.environment.title' });

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('the section reports the working-tree change count, the directory and the branch from the existing sources', async () => {
  answer(status());
  render(environment());

  await screen.findByText('main');

  // Two modified, one added and one untracked: what the Changes tab would list.
  const changes = screen.getByText('agentSidebar.environment.changes').parentElement!;
  assert.equal(within(changes).getByText('4').textContent, '4');

  const directory = screen.getByTitle('/work/alpha');
  assert.match(directory.textContent ?? '', /agentSidebar\.environment\.directory: alpha$/);

  const branch = screen.getByTitle('main');
  assert.match(branch.textContent ?? '', /agentSidebar\.environment\.branch: main$/);

  assert.deepEqual(requests, ['/api/git/status?project=project-alpha&sessionId=session-1']);
});

test('the rows are reports: the refresh control is the only button and reuses the summary hook', async () => {
  answer(status());
  render(environment());
  await screen.findByText('main');

  const buttons = within(section()).getAllByRole('button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].getAttribute('aria-label'), 'agentSidebar.environment.refresh');
  assert.equal(within(section()).queryByRole('link'), null);

  fireEvent.click(buttons[0]);
  await waitFor(() => assert.equal(requests.length, 2));
});

test('a directory that is not a repository says so and renders no branch or count', async () => {
  answer(JSON.stringify({ error: 'Project directory is not a git repository' }));
  render(environment());

  await screen.findByText('agentSidebar.environment.notARepository');

  assert.equal(screen.queryByText('agentSidebar.environment.changes'), null);
  assert.equal(screen.queryByText('main'), null);
  assert.doesNotMatch(section().textContent ?? '', /\b0\b/);
  // The directory is still a fact worth stating.
  assert.ok(screen.getByTitle('/work/alpha'));
});

test('a git failure is reported as unavailable rather than as zero changes', async () => {
  answer(() => new Response(JSON.stringify({ error: 'Git operation failed' }), { status: 500 }));
  render(environment());

  await screen.findByText('agentSidebar.environment.gitUnavailable');

  assert.equal(screen.queryByText('agentSidebar.environment.changes'), null);
  assert.doesNotMatch(section().textContent ?? '', /\b0\b/);
});

test('a repository whose branch git could not name omits the branch row', async () => {
  answer(status({ branch: '', modified: [], added: [], untracked: [], staged: [] }));
  render(environment());

  await screen.findByText('agentSidebar.environment.changes');

  assert.equal(screen.queryByText('agentSidebar.environment.branch'), null);
  assert.equal(screen.queryByText('main'), null);
  // A clean tree is a real zero, reported as one.
  assert.ok(within(screen.getByText('agentSidebar.environment.changes').parentElement!).getByText('0'));
});

test('without a project nothing is fetched and there is nothing to refresh', () => {
  answer(status());
  render(environment({ projectId: undefined, projectPath: undefined, sessionId: undefined }));

  assert.equal(requests.length, 0);
  assert.equal(within(section()).queryByRole('button'), null);
  assert.equal(screen.queryByTitle('/work/alpha'), null);
  assert.equal(screen.queryByText('agentSidebar.environment.changes'), null);
});

test('the runtime-reported directory wins over the execution path once the session reports one', async () => {
  answer(status());
  const snapshot: SessionStatusSnapshot = { ...EMPTY_SESSION_STATUS, sessionId: 'session-1', cwd: '/work/alpha/.gjc-worktrees/job-one/' };
  render(createElement(SessionStatusProvider, null,
    createElement(Publisher, { snapshot }, environment())));

  await screen.findByText('main');

  const directory = screen.getByTitle('/work/alpha/.gjc-worktrees/job-one/');
  assert.match(directory.textContent ?? '', /: job-one$/);
  assert.equal(screen.queryByTitle('/work/alpha'), null);
});
