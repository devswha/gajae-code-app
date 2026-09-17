import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { getPermissionPanel } from '../tools/configs/permissionPanelRegistry';
import type { PendingPermissionRequest, PermissionDecision } from '../types/types';
import PermissionRequestsBanner from '../view/PermissionRequestsBanner';

/*
 * Asking the user a question.
 *
 * The Protocol v1 worker in gjc-bun-ask-controller.ts raises one under the
 * runtime's tool name, `ask`. Unregistered, it rendered as a generic
 * "Permission required" with the question buried in a collapsed JSON blob —
 * and its bare Allow carries no answer, which the controller rejects by
 * design, leaving the question open and the turn stuck.
 */

/** The exact payload gjc-bun-ask-controller.ts sends for `uiContext.select`. */
const workerAskRequest: PendingPermissionRequest = {
  requestId: 'sdk-ask:1',
  toolName: 'ask',
  input: {
    questions: [{
      question: 'Which parser should I use?',
      header: 'GJC',
      options: [{ label: 'Recursive descent' }, { label: 'PEG' }],
      multiSelect: false,
    }],
  },
};

const renderBanner = (
  requests: PendingPermissionRequest[],
  onDecision: (id: string | string[], decision: PermissionDecision) => void = () => undefined,
) => renderToStaticMarkup(
  createElement(PermissionRequestsBanner, {
    pendingPermissionRequests: requests,
    handlePermissionDecision: onDecision,
  }),
);

test('the worker\'s ask resolves to the question panel', () => {
  // Importing the banner is what performs the registration.
  renderBanner([]);

  assert.notEqual(getPermissionPanel('ask'), null, 'ask has no panel');
  // The Node bridge's `AskUserQuestion` label went with the bridge; nothing
  // sends it, so nothing answers to it.
  assert.equal(getPermissionPanel('AskUserQuestion'), null);
});

test('a worker question renders its text and options, not a permission prompt', () => {
  const html = renderBanner([workerAskRequest]);

  assert.match(html, /Which parser should I use\?/);
  assert.match(html, /Recursive descent/);
  assert.match(html, /PEG/);
  // The generic fallback would show these instead.
  assert.doesNotMatch(html, /Permission required/);
  assert.doesNotMatch(html, /View tool input/);
});

test('a tool with no panel still gets the generic confirmation', () => {
  // The fallback has to keep working for everything that is not a question.
  // Without an i18n instance the keys render verbatim, which is what is asserted.
  const html = renderBanner([{ requestId: 'r1', toolName: 'bash', input: { command: 'ls' } }]);

  assert.match(html, /permissionCard\.title/);
  assert.match(html, /data-tool="bash"/);
  assert.match(html, /<code[^>]*>bash<\/code>/);
});

test('a tool permission card offers deny, allow, and always allow for the tool', () => {
  const html = renderBanner([{
    requestId: 'sdk-permission:1',
    toolName: 'bash',
    input: { command: 'npm test' },
    context: { source: 'sdk-permission', title: 'npm test', options: ['allow_once', 'allow_always', 'reject_once'] },
  }]);

  assert.match(html, /permissionCard\.deny/);
  assert.match(html, /permissionCard\.allow</);
  assert.match(html, /data-action="always-allow"/);
  // The runtime's own summary of the call is shown, not only the raw JSON.
  assert.match(html, /<code[^>]*title="npm test"[^>]*>npm test<\/code>/);
});

test('a question panel never shows the always-allow action', () => {
  const html = renderBanner([workerAskRequest]);
  assert.doesNotMatch(html, /always-allow/);
});
test('a question panel constrains viewport height and scrolls content while keeping actions pinned', () => {
  const html = renderBanner([workerAskRequest]);

  // Viewport constraint and vertical flex on card
  assert.match(html, /max-h-\[70dvh\]/);
  assert.match(html, /flex-col/);
  // Scroll container with overscroll-contain for mobile touch safety
  assert.match(html, /overflow-y-auto/);
  assert.match(html, /overscroll-contain/);
  // Header and footer are shrink-0
  assert.match(html, /shrink-0[^"]*px-4 pt-3\.5 pb-2/);
  assert.match(html, /shrink-0[^"]*border-t/);
});

test('plan-mode requests stay out of the banner', () => {
  for (const toolName of ['ExitPlanMode', 'exit_plan_mode']) {
    const html = renderBanner([{ requestId: 'r1', toolName, input: {} }]);
    assert.equal(html, '', `${toolName} is rendered inline by PlanDisplay`);
  }
});
