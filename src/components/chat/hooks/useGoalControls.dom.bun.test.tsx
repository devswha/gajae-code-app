import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';

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
function mount(strict = false, cached?: typeof snapshot) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  if (cached) client.setQueryData(['gjc-goal', 'project-a', 'app-a'], cached);
  return renderHook(({ sessionId }) => useGoalControlsWithConnection(connection, sessionId, 'project-a'), {
    initialProps: { sessionId: 'app-a' },
    reactStrictMode: strict,
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
  await waitFor(() => assert.equal(sent.length, 2));
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[0].requestId, result: snapshot });
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[1].requestId, result: { ...snapshot, canControl: false } });
  await waitFor(() => assert.equal(view.result.current.snapshot?.goal?.tokensUsed, 99));
  assert.equal(view.result.current.snapshot?.canControl, false);
  emit({ kind: 'status', sessionId: 'app-a', text: 'session_state', sessionState: { goal: snapshot } });
  await waitFor(() => assert.equal(view.result.current.snapshot?.canControl, false));
  assert.equal(sent.length, 2, 'same-run updates do not repeatedly request authority');
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

test('StrictMode effect replay preserves the first goal query without requiring Refresh', async () => {
  const view = mount(true);
  await waitFor(() => assert.ok(sent.length > 0));
  const paused = { ...snapshot, runId: null, goal: { ...goal, status: 'paused' } };
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent.at(-1)!.requestId, result: paused });
  await waitFor(() => assert.equal(view.result.current.snapshot?.goal?.status, 'paused'));
  assert.equal(view.result.current.error, undefined);
  assert.equal(view.result.current.snapshot?.canControl, true);
});

test('old view cleanup cannot cancel a new view query started during layout', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = renderHook(({ sessionId }) => {
    const controls = useGoalControlsWithConnection(connection, sessionId, 'project-a');
    useLayoutEffect(() => {
      if (sessionId === 'app-b') {
        const query = client.getQueryCache().find({ queryKey: ['gjc-goal', 'project-a', sessionId] });
        void query?.fetch().catch(() => {});
      }
    }, [sessionId]);
    return controls;
  }, {
    initialProps: { sessionId: 'app-a' },
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => assert.equal(sent.length, 1));
  view.rerender({ sessionId: 'app-b' });
  await waitFor(() => assert.ok(sent.some((message) => message.sessionId === 'app-b')));
  const request = [...sent].reverse().find((message) => message.sessionId === 'app-b')!;
  emit({ kind: 'chat_goal', sessionId: 'app-b', requestId: request.requestId, result: snapshot });
  await waitFor(() => assert.equal(view.result.current.snapshot?.goal?.id, goal.id));
  assert.equal(view.result.current.error, undefined);
});

test('replacing the subscription preserves outstanding requests for the same view', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = renderHook(({ subscribe }) => useGoalControlsWithConnection({ ...connection, subscribe }, 'app-a', 'project-a'), {
    initialProps: { subscribe: connection.subscribe },
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => assert.equal(sent.length, 1));
  view.rerender({ subscribe: (listener) => connection.subscribe(listener) });
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[0].requestId, result: snapshot });
  await waitFor(() => assert.equal(view.result.current.snapshot?.goal?.id, goal.id));
  assert.equal(view.result.current.error, undefined);
  assert.equal(sent.length, 1);
});

test('worker readiness retries a failed initial GET and waits for authenticated authority', async () => {
  const view = mount();
  await waitFor(() => assert.equal(sent.length, 1));
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[0].requestId, error: 'The run is still starting. Try again shortly.' });
  await waitFor(() => assert.match(view.result.current.error ?? '', /still starting/));
  emit({ kind: 'status', sessionId: 'app-a', text: 'session_state', sessionState: { goal: snapshot } });
  await waitFor(() => assert.equal(sent.length, 2));
  assert.equal(sent[1].operation, 'get');
  assert.equal(view.result.current.snapshot?.canControl, false);
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[1].requestId, result: snapshot });
  await waitFor(() => assert.equal(view.result.current.snapshot?.canControl, true));
  assert.equal(view.result.current.error, undefined);
});

test('cached data from a previous visit cannot suppress the new view readiness query', async () => {
  const view = mount(false, snapshot);
  await waitFor(() => assert.equal(sent.length, 1));
  assert.equal(view.result.current.snapshot?.canControl, false);
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[0].requestId, error: 'The run is still starting.' });
  await waitFor(() => assert.match(view.result.current.error ?? '', /still starting/));
  emit({ kind: 'status', sessionId: 'app-a', text: 'session_state', sessionState: { goal: snapshot } });
  await waitFor(() => assert.equal(sent.length, 2));
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[1].requestId, result: snapshot });
  await waitFor(() => assert.equal(view.result.current.snapshot?.canControl, true));
  assert.equal(view.result.current.error, undefined);
});

test('a new run cannot inherit authority from the previous run or its repeated broadcasts', async () => {
  const view = mount();
  await waitFor(() => assert.equal(sent.length, 1));
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[0].requestId, result: snapshot });
  await waitFor(() => assert.equal(view.result.current.snapshot?.canControl, true));
  const next = { ...snapshot, runId: 'run-b', goal: { ...goal, id: 'goal-b' } };
  emit({ kind: 'status', sessionId: 'app-a', text: 'session_state', sessionState: { goal: next } });
  await waitFor(() => assert.equal(sent.length, 2));
  assert.equal(view.result.current.snapshot?.canControl, false);
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[1].requestId, result: { ...next, canControl: false } });
  await waitFor(() => assert.equal(view.result.current.pending, false));
  emit({ kind: 'status', sessionId: 'app-a', text: 'session_state', sessionState: { goal: next } });
  assert.equal(view.result.current.snapshot?.canControl, false);
  assert.equal(sent.length, 2);
});

test('a delayed mutation response cannot overwrite a newer authenticated run snapshot', async () => {
  const view = mount();
  await waitFor(() => assert.equal(sent.length, 1));
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[0].requestId, result: snapshot });
  await waitFor(() => assert.equal(view.result.current.snapshot?.canControl, true));
  let control!: Promise<void>;
  act(() => { control = view.result.current.control({ operation: 'pause' }); });
  await waitFor(() => assert.equal(sent.length, 2));
  const next = { ...snapshot, runId: 'run-b', goal: { ...goal, id: 'goal-b' } };
  emit({ kind: 'status', sessionId: 'app-a', text: 'session_state', sessionState: { goal: next } });
  await waitFor(() => assert.equal(sent.length, 3));
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[2].requestId, result: next });
  await waitFor(() => assert.equal(view.result.current.snapshot?.canControl, true));
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[1].requestId,
    result: { ...snapshot, runId: null, goal: { ...goal, status: 'paused' } } });
  await act(async () => control);
  assert.equal(view.result.current.snapshot?.runId, 'run-b');
  assert.equal(view.result.current.snapshot?.goal?.id, 'goal-b');
  assert.equal(view.result.current.error, undefined);
});

test('navigation rejects old mutations without leaking their cleanup error into the new view', async () => {
  const view = mount();
  await waitFor(() => assert.equal(sent.length, 1));
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[0].requestId, result: snapshot });
  await waitFor(() => assert.equal(view.result.current.snapshot?.canControl, true));
  let control!: Promise<void>;
  act(() => { control = view.result.current.control({ operation: 'pause' }); });
  const cancelled = assert.rejects(control, /selected session changed/);
  await waitFor(() => assert.equal(sent.length, 2));
  view.rerender({ sessionId: 'app-b' });
  await act(async () => cancelled);
  await waitFor(() => assert.equal(sent.length, 3));
  emit({ kind: 'chat_goal', sessionId: 'app-b', requestId: sent[2].requestId, result: { ...snapshot, runId: null } });
  await waitFor(() => assert.equal(view.result.current.snapshot?.goal?.id, goal.id));
  assert.equal(view.result.current.error, undefined);
});

test('unmount rejects an outstanding mutation and removes its subscription', async () => {
  const view = mount();
  await waitFor(() => assert.equal(sent.length, 1));
  emit({ kind: 'chat_goal', sessionId: 'app-a', requestId: sent[0].requestId, result: snapshot });
  await waitFor(() => assert.equal(view.result.current.snapshot?.canControl, true));
  let control!: Promise<void>;
  act(() => { control = view.result.current.control({ operation: 'pause' }); });
  const cancelled = assert.rejects(control, /selected session changed/);
  view.unmount();
  await cancelled;
  assert.equal(listeners.size, 0);
});
