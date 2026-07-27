import assert from 'node:assert/strict';
import test from 'node:test';

import { decideQueuedDispatch } from './useQueuedMessageAutoSend';

/*
 * Queued-path dispositions.
 *
 * This producer fires for sessions the user is NOT looking at, so it has no
 * session UI to act through. Dispatching a slash command here sent destructive
 * runtime commands with no confirmation; acting on one locally would instead
 * drive whichever unrelated session happens to be on screen. Both are wrong —
 * the draft has to stay queued for its own session's composer.
 */

const draft = (content: string) => ({ content, options: { model: 'test-model' } });

test('plain prose is auto-sent with its queued options', () => {
  const decision = decideQueuedDispatch(draft('finish the refactor'), true);
  assert.equal(decision.action, 'send');
  assert.equal(decision.action === 'send' ? decision.content : '', 'finish the refactor');
  assert.deepEqual(
    decision.action === 'send' ? decision.options : null,
    { model: 'test-model' },
  );
});

test('a queued app-action form is held for the owning session', () => {
  // Sending these would run a UI action in whatever session is on screen.
  for (const form of ['/new', '/resume', '/sessions', '/settings', '/model']) {
    const decision = decideQueuedDispatch(draft(form), true);
    assert.equal(decision.action, 'hold', `${form} must not auto-send`);
    assert.equal(decision.action === 'hold' ? decision.reason : '', 'needs-session-ui');
  }
});

test('a queued local-notice form is held for the owning session', () => {
  // These need the owning session's message list to render into.
  for (const form of ['/retry', '/goal', '/theme', '/copy', '/exit', '/hotkeys']) {
    const decision = decideQueuedDispatch(draft(form), true);
    assert.equal(decision.action, 'hold', `${form} must not auto-send`);
    assert.equal(decision.action === 'hold' ? decision.reason : '', 'needs-session-ui');
  }
});

test('a queued destructive runtime command is never auto-sent', () => {
  for (const form of [
    '/clear',
    '/session delete',
    '/memory clear',
    '/contribute-pr',
    '/logout',
    '/ssh rm e2e-host',
    '/skill:team',
  ]) {
    const decision = decideQueuedDispatch(draft(form), true);
    assert.equal(decision.action, 'hold', `${form} must not auto-send`);
    assert.equal(decision.action === 'hold' ? decision.reason : '', 'needs-session-ui');
  }
});

test('an unrecognized slash form is held rather than dispatched blind', () => {
  const decision = decideQueuedDispatch(draft('/some-future-command'), true);
  assert.equal(decision.action, 'hold');
  assert.equal(decision.action === 'hold' ? decision.reason : '', 'needs-session-ui');
});

test('a closed socket holds the draft instead of dropping it', () => {
  const decision = decideQueuedDispatch(draft('hello'), false);
  assert.equal(decision.action, 'hold');
  assert.equal(decision.action === 'hold' ? decision.reason : '', 'socket-closed');
});

test('no draft is a no-op', () => {
  const decision = decideQueuedDispatch(null, true);
  assert.equal(decision.action, 'hold');
  assert.equal(decision.action === 'hold' ? decision.reason : '', 'no-draft');
});

test('a held draft is never reported as sendable, so the claim ticket survives', () => {
  // The storage key is the claim shared with the composer's flush path. A hold
  // must leave it in place; only `send` may clear it.
  for (const form of ['/new', '/retry', '/clear', '/unknown-thing']) {
    assert.notEqual(decideQueuedDispatch(draft(form), true).action, 'send', form);
  }
});
