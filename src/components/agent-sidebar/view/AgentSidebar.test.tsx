import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AgentSidebar, { type AgentSidebarProps } from './AgentSidebar';

function render(overrides: Partial<AgentSidebarProps> = {}): string {
  const props: AgentSidebarProps = {
    isMobile: false,
    projectId: 'project-alpha',
    projectPath: '/work/alpha',
    sessionId: 'session-1',
    onClose: () => undefined,
    ...overrides,
  };

  return renderToStaticMarkup(createElement(AgentSidebar, props));
}

test('the desktop surface is a labelled lane holding the environment in one compact card', () => {
  const html = render();

  assert.match(html, /<aside aria-label="agentSidebar\.title"/);
  // The card is the only thing in the lane, and the environment is the only thing in the card.
  assert.match(html, /<aside[^>]*><div class="rounded-xl border border-border\/60 bg-card\/50"><section aria-labelledby="agent-sidebar-environment"/);
  assert.match(html, /<\/section><\/div><\/aside>$/);
});

test('the desktop surface has no header of its own: Environment is the top-level heading', () => {
  const html = render();

  assert.doesNotMatch(html, /<h2/);
  assert.doesNotMatch(html, /aria-label="agentSidebar\.close"/);
  assert.match(html, /<h3 id="agent-sidebar-environment"[^>]*>agentSidebar\.environment\.title<\/h3>/);
  // The refresh control is the only button in the whole surface.
  const buttons = html.match(/<button/g) ?? [];
  assert.equal(buttons.length, 1);
  assert.match(html, /<button[^>]*aria-label="agentSidebar\.environment\.refresh"/);
});

test('the desktop surface is not presented as a full-height rail', () => {
  const html = render();
  const aside = html.match(/<aside[^>]*>/)?.[0] ?? '';

  // No resize handle, no persisted width, no rail chrome on the lane itself.
  assert.doesNotMatch(html, /role="separator"/);
  assert.doesNotMatch(html, /style="width:/);
  assert.doesNotMatch(aside, /border-l|bg-sidebar|inset-y-0|h-full/);
  // Sized to the content: the lane is a column whose only child is the card.
  assert.match(aside, /class="[^"]*\bflex\b[^"]*\bflex-col\b/);
  assert.match(aside, /class="[^"]*\bw-64\b[^"]*\blg:w-80\b/);
});

test('the surface carries no tab strip and no expand control', () => {
  for (const html of [render(), render({ isMobile: true })]) {
    assert.doesNotMatch(html, /role="tablist"/);
    assert.doesNotMatch(html, /role="tab"/);
    assert.doesNotMatch(html, /role="tabpanel"/);
    assert.doesNotMatch(html, /aria-pressed/);
  }
});

test('the mobile surface is still a drawer with a backdrop, a titled header and a close control', () => {
  const html = render({ isMobile: true });

  // Above the chat, below the mobile navigation, so navigation always wins.
  assert.match(html, /class="fixed inset-0 z-30 bg-background\/80 backdrop-blur-xs"/);
  assert.match(html, /<aside aria-label="agentSidebar\.title" class="fixed inset-y-0 right-0 z-40/);
  assert.match(html, /<h2[^>]*>agentSidebar\.title<\/h2>/);
  assert.match(html, /<section aria-labelledby="agent-sidebar-environment"/);
  assert.doesNotMatch(html, /role="separator"/);

  const closeLabels = html.match(/aria-label="agentSidebar\.close"/g) ?? [];
  assert.equal(closeLabels.length, 2);
});
