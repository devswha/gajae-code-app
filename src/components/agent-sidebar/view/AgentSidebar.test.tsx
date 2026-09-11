import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MAX_AGENT_SIDEBAR_WIDTH, MIN_AGENT_SIDEBAR_WIDTH } from '../agentSidebarState';

import AgentSidebar, { type AgentSidebarProps } from './AgentSidebar';

function render(overrides: Partial<AgentSidebarProps> = {}): string {
  const props: AgentSidebarProps = {
    width: 420,
    isMobile: false,
    onResizeStart: () => undefined,
    onResizeKeyDown: () => undefined,
    onClose: () => undefined,
    ...overrides,
  };

  return renderToStaticMarkup(createElement(AgentSidebar, props));
}

test('the desktop sidebar is a labelled complementary region whose body is the environment summary', () => {
  const html = render({ projectId: 'project-alpha', projectPath: '/work/alpha' });

  assert.match(html, /<aside aria-label="agentSidebar\.title"/);
  assert.match(html, /<h2[^>]*>agentSidebar\.title<\/h2>/);
  assert.match(html, /<section aria-labelledby="agent-sidebar-environment"/);
  assert.match(html, /<h3 id="agent-sidebar-environment"[^>]*>agentSidebar\.environment\.title<\/h3>/);
  // The rail has stable content now; there is no "nothing here" state left.
  assert.doesNotMatch(html, /agentSidebar\.empty/);
});

test('the environment is the body on mobile too', () => {
  const html = render({ isMobile: true, projectId: 'project-alpha', projectPath: '/work/alpha' });

  assert.match(html, /<section aria-labelledby="agent-sidebar-environment"/);
});

test('the resize handle is a focusable separator carrying the current width', () => {
  const html = render({ width: 420 });

  assert.match(html, /role="separator"/);
  assert.match(html, /aria-orientation="vertical"/);
  assert.match(html, /aria-valuenow="420"/);
  assert.match(html, new RegExp(`aria-valuemin="${MIN_AGENT_SIDEBAR_WIDTH}"`));
  // Without a max, ARIA assumes 0..100 and a 420px value reads as a percentage.
  assert.match(html, new RegExp(`aria-valuemax="${MAX_AGENT_SIDEBAR_WIDTH}"`));
  assert.match(html, /role="separator"[^>]*tabindex="0"/);
  assert.match(html, /style="width:420px/);
});

test('the sidebar keeps one close control, labelled for assistive technology', () => {
  const closeLabels = render().match(/aria-label="agentSidebar\.close"/g) ?? [];

  assert.equal(closeLabels.length, 1);
});

test('the shell carries no tab strip and no expand control', () => {
  const props = { projectId: 'project-alpha', projectPath: '/work/alpha', sessionId: 'session-1' };
  for (const html of [render(props), render({ ...props, isMobile: true })]) {
    assert.doesNotMatch(html, /role="tablist"/);
    assert.doesNotMatch(html, /role="tab"/);
    assert.doesNotMatch(html, /role="tabpanel"/);
    assert.doesNotMatch(html, /aria-pressed/);
  }
});

test('the mobile sidebar is an overlay with a dismiss backdrop and no resizing', () => {
  const html = render({ isMobile: true });

  // Above the chat, below the mobile navigation, so navigation always wins.
  assert.match(html, /class="fixed inset-0 z-30 bg-background\/80 backdrop-blur-xs"/);
  assert.match(html, /fixed inset-y-0 right-0 z-40/);
  assert.doesNotMatch(html, /role="separator"/);
  assert.doesNotMatch(html, /style="width:/);

  const closeLabels = html.match(/aria-label="agentSidebar\.close"/g) ?? [];
  assert.equal(closeLabels.length, 2);
});
