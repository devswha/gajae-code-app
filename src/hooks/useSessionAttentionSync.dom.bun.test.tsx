import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, render } from '@testing-library/react';

import type { ServerEvent } from '../contexts/WebSocketContext';
import { resetSessionAttentionStore, useSessionAttentionStore } from '../stores/useSessionAttentionStore';

import { observeOutgoingChatMessage, useSessionAttentionSync } from './useSessionAttentionSync';
import type { SessionActivityMap } from './useSessionProtection';

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetSessionAttentionStore();
  document.title = 'Gajae Code App';
});

type HarnessProps = { viewedSessionId: string | null; processingSessions: SessionActivityMap };

function mountHarness(initial: HarnessProps) {
  const listeners = new Set<(event: ServerEvent) => void>();
  const subscribe = (listener: (event: ServerEvent) => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  function Harness(props: HarnessProps) {
    useSessionAttentionSync({ subscribe, ...props });
    return null;
  }
  const view = render(<Harness {...initial} />);
  return {
    emit: (event: ServerEvent) => act(() => { listeners.forEach((listener) => listener(event)); }),
    rerender: (props: HarnessProps) => view.rerender(<Harness {...props} />),
  };
}

const state = () => useSessionAttentionStore.getState();
const activity = (awaitingInput: boolean) => ({ statusText: null, canInterrupt: true, startedAt: 1, awaitingInput });

test('a background completion becomes an unread outcome; the open session is marked viewed instead', () => {
  const { emit } = mountHarness({ viewedSessionId: 'open', processingSessions: new Map() });

  emit({ kind: 'complete', sessionId: 'background', success: true });
  emit({ kind: 'complete', sessionId: 'failed', success: false, exitCode: 1 });
  emit({ kind: 'complete', sessionId: 'stopped', success: false, aborted: true });
  emit({ kind: 'complete', sessionId: 'open', success: true });

  assert.equal(state().outcomes.background?.kind, 'ready');
  assert.equal(state().outcomes.failed?.kind, 'blocked');
  assert.equal(state().outcomes.stopped, undefined, 'the user stopped it themselves');
  assert.equal(state().outcomes.open, undefined);
  assert.ok(state().lastViewedAt.open, 'the open session was seen as it finished');
});

test('a protocol error ends a background run as blocked', () => {
  const { emit } = mountHarness({ viewedSessionId: null, processingSessions: new Map() });
  emit({ kind: 'protocol_error', sessionId: 'broken', code: 'WORKER_EXIT', error: 'gone' });
  assert.equal(state().outcomes.broken?.kind, 'blocked');
});

test('approvals raise and lower needs-input for whichever session they belong to', () => {
  const { emit } = mountHarness({ viewedSessionId: 'open', processingSessions: new Map() });

  emit({ kind: 'permission_request', sessionId: 'background', requestId: 'ask-1', toolName: 'bash' });
  emit({ kind: 'permission_request', sessionId: 'background', requestId: 'plan', toolName: 'ExitPlanMode' });
  assert.deepEqual(state().pendingInput.background?.requestIds, ['ask-1'], 'plan exits ask nothing');

  emit({ kind: 'permission_cancelled', sessionId: 'background', requestId: 'ask-1' });
  assert.equal(state().pendingInput.background, undefined);

  emit({ kind: 'chat_subscribed', sessionId: 'open', isProcessing: true, pendingPermissions: [{ requestId: 'ask-2', toolName: 'edit' }, { requestId: 'p', toolName: 'exit_plan_mode' }] });
  assert.deepEqual(state().pendingInput.open?.requestIds, ['ask-2']);

  observeOutgoingChatMessage({ type: 'chat.permission-response', requestId: 'ask-2', allow: true });
  assert.equal(state().pendingInput.open, undefined, 'answering from this browser clears it at once');

  emit({ kind: 'permission_request', sessionId: 'background', requestId: 'ask-3', toolName: 'bash' });
  emit({ kind: 'complete', sessionId: 'background', success: true });
  assert.equal(state().pendingInput.background, undefined, 'a finished run has no open questions');
});

test('the running-sessions poll adds questions this browser never saw and drops stale ones', () => {
  const { rerender } = mountHarness({ viewedSessionId: null, processingSessions: new Map() });

  act(() => { rerender({ viewedSessionId: null, processingSessions: new Map([['elsewhere', activity(true)]]) }); });
  assert.deepEqual(state().pendingInput.elsewhere?.requestIds, ['server:elsewhere']);

  act(() => { rerender({ viewedSessionId: null, processingSessions: new Map([['elsewhere', activity(false)]]) }); });
  assert.equal(state().pendingInput.elsewhere, undefined);
});

test('starting a run or viewing a session clears what the last run left behind', () => {
  state().recordOutcome('again', { kind: 'blocked', at: 1 });
  observeOutgoingChatMessage({ type: 'chat.send', sessionId: 'again', content: 'retry' });
  assert.equal(state().outcomes.again, undefined);

  state().recordOutcome('later', { kind: 'ready', at: 1 });
  document.title = '[Done] Gajae Code App';
  const { rerender } = mountHarness({ viewedSessionId: null, processingSessions: new Map() });
  act(() => { rerender({ viewedSessionId: 'later', processingSessions: new Map() }); });
  assert.equal(state().outcomes.later, undefined);
  assert.equal(document.title, 'Gajae Code App', 'the tab stops announcing a completion the user has now seen');
});

test('live run events retire a stale outcome without touching an unrelated session', () => {
  state().recordOutcome('resumed', { kind: 'ready', at: 1 });
  state().recordOutcome('other', { kind: 'ready', at: 1 });
  const { emit } = mountHarness({ viewedSessionId: null, processingSessions: new Map() });
  emit({ kind: 'stream_delta', sessionId: 'resumed', content: 'more' });
  assert.equal(state().outcomes.resumed, undefined);
  assert.equal(state().outcomes.other?.kind, 'ready');
});
