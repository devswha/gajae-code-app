import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EMPTY_SESSION_STATUS, type SessionStatusSnapshot } from '../../../contexts/sessionStatusSnapshot';

import WorkspaceStatusTab, { type WorkspaceStatusTabProps } from './WorkspaceStatusTab';

const liveSession: SessionStatusSnapshot = {
  sessionId: 'session-1',
  modelId: 'anthropic/claude-sonnet',
  thinkingLevel: 'high',
  cwd: '/work/alpha',
  contextTokens: 24_000,
  contextWindow: 200_000,
  contextPercent: 12,
  tokens: { used: 15_400, input: 12_000, output: 3_000, cache: 400 },
  activity: { running: true, statusText: null, queued: 0 },
};

function render(overrides: Partial<WorkspaceStatusTabProps> = {}): string {
  const props: WorkspaceStatusTabProps = {
    status: liveSession,
    projectName: 'Alpha Workspace',
    projectPath: '/work/alpha',
    projectId: 'project-alpha',
    active: true,
    ...overrides,
  };

  return renderToStaticMarkup(createElement(WorkspaceStatusTab, props));
}

test('a live session reports the model, reasoning level and working directory', () => {
  const html = render();

  assert.match(html, /anthropic\/claude-sonnet/);
  // The picker's own label, not the raw token the runtime reports.
  assert.match(html, /High/);
  assert.match(html, /\/work\/alpha/);
});

test('an effort level the picker does not offer is shown as reported', () => {
  const html = render({ status: { ...liveSession, thinkingLevel: 'ludicrous' } });

  assert.match(html, /ludicrous/);
});

test('context is reported as tokens, a percentage and an accessible bar', () => {
  const html = render();

  assert.match(html, /24K/);
  assert.match(html, /\(12%\)/);
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="12"/);
  assert.match(html, /200K/);
});

test('a context near the window is styled as the warning it is', () => {
  const html = render({ status: { ...liveSession, contextPercent: 92 } });

  assert.match(html, /bg-destructive/);
});

test('token totals render only the buckets the runtime reported', () => {
  const html = render({ status: { ...liveSession, tokens: { used: 1_200 } } });

  assert.match(html, /statusTab\.tokensUsed/);
  assert.doesNotMatch(html, /statusTab\.tokensInput/);
  assert.doesNotMatch(html, /statusTab\.tokensCache/);
});

test('a session that reported no usage shows no token section at all', () => {
  const html = render({ status: { ...liveSession, tokens: undefined } });

  assert.doesNotMatch(html, /statusTab\.tokensUsed/);
});

test('unreported facts say so instead of rendering a zero', () => {
  const html = render({
    status: {
      sessionId: 'session-1',
      activity: { running: false, statusText: null, queued: 0 },
    },
  });

  assert.match(html, /statusTab\.unreported/);
  assert.doesNotMatch(html, /role="progressbar"/);
  assert.doesNotMatch(html, /\(0%\)/);
});

test('a queued follow-up is only mentioned when one exists', () => {
  assert.doesNotMatch(render(), /statusTab\.queuedMessage/);
  assert.match(
    render({ status: { ...liveSession, activity: { running: true, statusText: null, queued: 1 } } }),
    /statusTab\.queuedMessage/,
  );
});

test('a provider phase replaces the generic running label', () => {
  const html = render({ status: { ...liveSession, activity: { running: true, statusText: 'Compacting', queued: 0 } } });

  assert.match(html, /Compacting/);
  assert.doesNotMatch(html, /statusTab\.running/);
});

test('with no session the tab explains itself but still locates the project', () => {
  const html = render({ status: EMPTY_SESSION_STATUS });

  assert.match(html, /statusTab\.empty/);
  assert.match(html, /Alpha Workspace/);
  assert.doesNotMatch(html, /statusTab\.model/);
});

test('git reports through its own section and never renders a write control', () => {
  const html = render();

  assert.match(html, /statusTab\.git/);
  assert.match(html, /aria-label="workspace\.statusTab\.refreshGit"/);
  assert.doesNotMatch(html, /commit|push|pull|discard/i);
});
