import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { createElement, useEffect, useRef } from 'react';

import type { ServerEvent } from '../../../contexts/WebSocketContext';
import { useSessionStore, type SessionStore } from '../../../stores/useSessionStore';

import { useChatRealtimeHandlers } from './useChatRealtimeHandlers';

/*
 * The stream frames as the transcript sees them. `stream_delta` accumulates
 * (debounced into one streaming row), `stream_end` finalizes it. The whole
 * answer rides on `stream_end`, so a viewer that received no deltas - the
 * SDK did not stream, or the tab joined the turn late - still ends the turn
 * with the answer on screen rather than waiting for a reload.
 */

afterEach(cleanup);

type Call = [string, ...unknown[]];

function fakeStore(calls: Call[]): SessionStore {
  const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  return {
    updateStreaming: record('updateStreaming'),
    finalizeStreaming: record('finalizeStreaming'),
    appendRealtime: record('appendRealtime'),
    refreshFromServer: async (...args: unknown[]) => { calls.push(['refreshFromServer', ...args]); },
  } as unknown as SessionStore;
}

function Probe({ emit, store, calls, visibleSessionId }: { emit: { current: ((event: ServerEvent) => void) | null }; store: SessionStore; calls: Call[]; visibleSessionId: string }) {
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  const lastSeqRef = useRef(new Map<string, number>());
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  // ChatInterface clears its visible accumulator when the selected session
  // changes. The per-session store deliberately survives that navigation.
  useEffect(() => () => {
    if (streamTimerRef.current) cancelAnimationFrame(streamTimerRef.current);
    streamTimerRef.current = null;
    accumulatedStreamRef.current = '';
  }, [visibleSessionId]);
  useChatRealtimeHandlers({
    subscribe: (listener) => { emit.current = listener; return () => { emit.current = null; }; },
    provider: 'gjc',
    selectedSession: { id: visibleSessionId } as never,
    currentSessionId: visibleSessionId,
    setTokenBudget: (budget) => { calls.push(['setTokenBudget', budget]); },
    setSessionState: () => { calls.push(['setSessionState']); },
    onSteerResult: (...args) => { calls.push(['onSteerResult', ...args]); },
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef,
    accumulatedStreamRef,
    lastSeqRef,
    statusCheckSentAtRef,
    sessionStore: store,
  });
  return null;
}

function mount(store?: SessionStore, visibleSessionId = 'visible') {
  const calls: Call[] = [];
  const emit: { current: ((event: ServerEvent) => void) | null } = { current: null };
  const props = { emit, store: store ?? fakeStore(calls), calls };
  const view = render(createElement(Probe, { ...props, visibleSessionId }));
  assert.ok(emit.current, 'the hook subscribed');
  return {
    calls,
    send: (event: ServerEvent) => act(() => { emit.current?.(event); }),
    switchTo: (id: string) => view.rerender(createElement(Probe, { ...props, visibleSessionId: id })),
  };
}

test('an answer that arrives whole on stream_end is shown without any delta', () => {
  const { calls, send } = mount();
  send({ kind: 'stream_end', sessionId: 'visible', content: 'The moon is far.' } as ServerEvent);

  assert.deepEqual(calls, [
    ['updateStreaming', 'visible', 'The moon is far.', 'gjc'],
    ['finalizeStreaming', 'visible'],
  ]);
});

test('stream_end outranks the deltas a late viewer accumulated', async () => {
  const { calls, send } = mount();
  send({ kind: 'stream_delta', sessionId: 'visible', content: 'is far.' } as ServerEvent);
  await new Promise((resolve) => setTimeout(resolve, 150));
  send({ kind: 'stream_end', sessionId: 'visible', content: 'The moon is far.' } as ServerEvent);

  assert.deepEqual(calls, [
    ['updateStreaming', 'visible', 'is far.', 'gjc'],
    ['updateStreaming', 'visible', 'The moon is far.', 'gjc'],
    ['finalizeStreaming', 'visible'],
  ]);
});

test('an empty stream_end after no deltas finalizes nothing', () => {
  const { calls, send } = mount();
  send({ kind: 'stream_end', sessionId: 'visible', content: '' } as ServerEvent);

  assert.deepEqual(calls, [['finalizeStreaming', 'visible']]);
});

test('interleaved background deltas never enter the visible answer', () => {
  const { calls, send } = mount();
  send({ kind: 'stream_delta', sessionId: 'visible', content: 'Visible answer' } as ServerEvent);
  send({ kind: 'stream_delta', sessionId: 'background', content: 'Background answer' } as ServerEvent);
  send({ kind: 'stream_end', sessionId: 'visible', content: '' } as ServerEvent);

  assert.deepEqual(calls.filter(([name]) => name === 'updateStreaming'), [
    ['updateStreaming', 'visible', 'Visible answer', 'gjc'],
  ]);
  assert.equal(calls.filter(([name, id]) => name === 'appendRealtime' && id === 'background').length, 1);
});

test('a background stream ending cannot consume or cancel the visible stream', () => {
  const { calls, send } = mount();
  send({ kind: 'stream_delta', sessionId: 'visible', content: 'Visible answer' } as ServerEvent);
  send({ kind: 'stream_end', sessionId: 'background', content: 'Background answer' } as ServerEvent);
  send({ kind: 'complete', sessionId: 'background', aborted: true } as ServerEvent);
  send({ kind: 'stream_end', sessionId: 'visible', content: '' } as ServerEvent);

  assert.ok(calls.some(([name, id, text]) => name === 'updateStreaming' && id === 'visible' && text === 'Visible answer'));
  assert.ok(calls.some(([name, id, content]) => name === 'updateStreaming' && id === 'background' && content === 'Background answer'));
  assert.ok(calls.some(([name, id]) => name === 'finalizeStreaming' && id === 'background'));
});

test('background status frames cannot overwrite the displayed session metadata', () => {
  const { calls, send } = mount();
  send({ kind: 'status', sessionId: 'background', text: 'token_budget', tokenBudget: { used: 999 } } as ServerEvent);
  send({ kind: 'status', sessionId: 'background', text: 'session_state', sessionState: { model: 'other' } } as ServerEvent);
  assert.deepEqual(calls, []);
  send({ kind: 'status', sessionId: 'visible', text: 'token_budget', tokenBudget: { used: 5 } } as ServerEvent);
  assert.deepEqual(calls, [['setTokenBudget', { used: 5 }]]);
});

test('steering replies retain the session that originated the request', () => {
  const { calls, send } = mount();
  send({ kind: 'chat_steered', sessionId: 'background', content: 'next step', steered: true } as ServerEvent);
  assert.deepEqual(calls, [['onSteerResult', 'next step', true, 'background']]);
});

test('a background final answer is reconciled with persisted history exactly once', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(useSessionStore, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  });
  const { send } = mount(view.result.current);
  const common = { sessionId: 'background', provider: 'gjc' as const };
  const user = { ...common, id: 'user', timestamp: '2026-01-01T00:00:00Z', kind: 'text' as const, role: 'user' as const, content: 'answer' };
  send(user);
  send({ ...common, id: 'end', timestamp: '2026-01-01T00:00:01Z', kind: 'stream_end', content: 'Background answer' } as ServerEvent);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ messages: [
    user,
    { ...common, id: 'persisted', timestamp: '2026-01-01T00:00:01Z', kind: 'text', role: 'assistant', content: 'Background answer' },
  ], total: 2, hasMore: false }))) as typeof fetch;
  try {
    await act(async () => { await view.result.current.refreshFromServer('background'); });
    assert.equal(view.result.current.getMessages('background').filter((row) => row.content === 'Background answer').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const endContent of ['A first answer', '']) {
  test(`A → B → A starts a fresh streaming row after ${endContent ? 'a full' : 'an empty'} background stream_end`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(useSessionStore, {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
    });
    const store = view.result.current;
    const { send, switchTo } = mount(store, 'a');
    const user = {
      id: 'first-prompt', sessionId: 'a', provider: 'gjc' as const,
      timestamp: new Date().toISOString(), kind: 'text' as const, role: 'user' as const, content: 'First prompt',
    };
    send(user);
    send({ kind: 'stream_delta', sessionId: 'a', content: 'A first' } as ServerEvent);
    await waitFor(() => assert.ok(store.getMessages('a').some((row) => row.id === '__streaming_a')));

    switchTo('b');
    send({ kind: 'stream_delta', sessionId: 'b', content: 'B ongoing answer' } as ServerEvent);
    send({ kind: 'stream_end', sessionId: 'a', content: endContent } as ServerEvent);
    const afterBackgroundEnd = store.getSessionSlot('a')!.realtimeMessages;
    send({ kind: 'stream_end', sessionId: 'b', content: '' } as ServerEvent);
    assert.deepEqual(store.getMessages('b').map((row) => row.content), ['B ongoing answer'], 'A must not touch B accumulator');

    switchTo('a');
    if (endContent) {
      // Reloading history hides a matching final answer, but used to retain
      // the old reserved row because its partial content was not equal.
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => new Response(JSON.stringify({ messages: [
        user,
        { ...user, id: 'persisted-answer', role: 'assistant', content: endContent, timestamp: new Date().toISOString() },
      ], total: 2, hasMore: false }))) as typeof fetch;
      try {
        await act(async () => { await store.refreshFromServer('a'); });
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
    const nextPrompt = { ...user, id: 'next-prompt', timestamp: new Date().toISOString(), content: 'Next prompt' };
    send(nextPrompt);
    send({ kind: 'stream_delta', sessionId: 'a', content: 'A next answer' } as ServerEvent);
    await waitFor(() => assert.ok(store.getMessages('a').some((row) => row.id === '__streaming_a' && row.content === 'A next answer')));
    assert.deepEqual(store.getMessages('a').map((row) => row.content), [
      'First prompt', endContent || 'A first', 'Next prompt', 'A next answer',
    ], 'the new answer belongs after the new user turn');
    assert.equal(afterBackgroundEnd.some((row) => row.id === '__streaming_a'), false, 'stream_end must retire A reserved row');
    const nextStream = store.getSessionSlot('a')!.realtimeMessages.find((row) => row.id === '__streaming_a')!;
    assert.ok(Date.parse(nextStream.timestamp) >= Date.parse(nextPrompt.timestamp), 'the new stream starts with a new timestamp');
    send({ kind: 'stream_end', sessionId: 'a', content: 'A next answer' } as ServerEvent);
    assert.equal(store.getSessionSlot('a')!.realtimeMessages.some((row) => row.id === '__streaming_a'), false);
  });
}
