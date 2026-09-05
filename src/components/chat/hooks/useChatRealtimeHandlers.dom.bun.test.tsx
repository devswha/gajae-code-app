import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement, useRef } from 'react';

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

function Probe({ emit, store, calls }: { emit: { current: ((event: ServerEvent) => void) | null }; store: SessionStore; calls: Call[] }) {
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  const lastSeqRef = useRef(new Map<string, number>());
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  useChatRealtimeHandlers({
    subscribe: (listener) => { emit.current = listener; return () => { emit.current = null; }; },
    provider: 'gjc',
    selectedSession: { id: 'visible' } as never,
    currentSessionId: 'visible',
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

function mount(store?: SessionStore) {
  const calls: Call[] = [];
  const emit: { current: ((event: ServerEvent) => void) | null } = { current: null };
  render(createElement(Probe, { emit, store: store ?? fakeStore(calls), calls }));
  assert.ok(emit.current, 'the hook subscribed');
  return { calls, send: (event: ServerEvent) => act(() => { emit.current?.(event); }) };
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
  assert.ok(calls.some(([name, id, value]) => name === 'appendRealtime' && id === 'background'
    && (value as { content: string; kind: string }).content === 'Background answer'
    && (value as { kind: string }).kind === 'text'));
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
