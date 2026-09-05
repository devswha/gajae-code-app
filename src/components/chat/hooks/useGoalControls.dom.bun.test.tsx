import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useGoalControlsWithConnection } from './useGoalControls';

const listeners = new Set<(event: Record<string, unknown>) => void>();
const sent: Array<Record<string, unknown>> = [];
const connection = {
  isConnected: true,
  subscribe: (listener: (event: Record<string, unknown>) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  sendMessage: (message: unknown) => { sent.push(message as Record<string, unknown>); return true; },
};
afterEach(() => { cleanup(); listeners.clear(); sent.length = 0; });

const goal = { id: 'goal-a', objective: 'Scoped goal', status: 'active' as const, tokensUsed: 2, timeUsedSeconds: 1, createdAt: 1, updatedAt: 2 };
const snapshot = { supported: true, goal, runId: 'run-a', canControl: true, resumeRequired: false };
function emit(event: Record<string, unknown>) { act(() => { for (const listener of listeners) listener(event); }); }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderHook(({ sessionId }) => useGoalControlsWithConnection(connection, sessionId, 'project-a'), {
    initialProps: { sessionId: 'app-a' },
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

test('goal control requests bind the visible app session, project, goal and exact run', async () => {
  const view = mount();
  await waitFor(() => assert.equal(sent.length, 1));
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[0].requestId, result: snapshot });
  await waitFor(() => assert.equal(view.result.current.snapshot?.goal?.id, 'goal-a'));
  let control!: Promise<void>;
  act(() => { control = view.result.current.control({ operation: 'pause' }); });
  await waitFor(() => assert.equal(sent.length, 2));
  assert.deepEqual({ ...sent[1], requestId: 'request' }, {
    type: 'chat.goal', sessionId: 'app-a', projectId: 'project-a', requestId: 'request', operation: 'pause', runId: 'run-a', goalId: 'goal-a',
  });
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[1].requestId, result: { ...snapshot, goal: { ...goal, status: 'paused' }, runId: null } });
  await act(async () => control);
  await waitFor(() => assert.equal(view.result.current.snapshot?.goal?.status, 'paused'));
});

test('newer goal events win over in-flight snapshots and cannot grant another viewer control', async () => {
  const view = mount();
  await waitFor(() => assert.equal(sent.length, 1));
  emit({ kind: 'status', sessionId: 'app-a', text: 'session_state', sessionState: { goal: { ...snapshot, goal: { ...goal, tokensUsed: 99 } } } });
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[0].requestId, result: { ...snapshot, canControl: false } });
  await waitFor(() => assert.equal(view.result.current.snapshot?.goal?.tokensUsed, 99));
  assert.equal(view.result.current.snapshot?.canControl, false);
  emit({ kind: 'status', sessionId: 'app-a', text: 'session_state', sessionState: { goal: snapshot } });
  await waitFor(() => assert.equal(view.result.current.snapshot?.canControl, false));
  emit({ kind: 'status', sessionId: 'other-app', text: 'session_state', sessionState: { goal: { ...snapshot, goal: null } } });
  assert.equal(view.result.current.snapshot?.goal?.id, 'goal-a');
});

test('changing sessions rejects outstanding controls and ignores late responses for the old view', async () => {
  const view = mount();
  await waitFor(() => assert.equal(sent.length, 1));
  const oldRequest = sent[0].requestId;
  view.rerender({ sessionId: 'app-b' });
  await waitFor(() => assert.equal(sent.length, 2));
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: oldRequest, result: snapshot });
  emit({ kind: 'chat_goal', sessionId: 'app-b', requestId: sent[1].requestId, result: { ...snapshot, goal: null, runId: null } });
  await waitFor(() => assert.equal(view.result.current.snapshot?.goal, null));
});
