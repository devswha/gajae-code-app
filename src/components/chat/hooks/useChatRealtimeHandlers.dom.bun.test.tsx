import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { createElement, useEffect, useRef } from 'react';

import type { ServerEvent } from '../../../contexts/WebSocketContext';
import { useSessionStore, type SessionStore } from '../../../stores/useSessionStore';
import '../../../i18n/config';
import MessageComponent from '../view/MessageComponent';
import { assignMessageKeys } from '../utils/messageKeys';

import { useChatRealtimeHandlers } from './useChatRealtimeHandlers';
import { normalizedToChatMessages } from './useChatMessages';

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
    acceptRealtimeEvent: () => true,
    getReplayCursor: () => ({ replayGeneration: null, lastSeq: 0 }),
    trackReplayFrame: () => true,
    getSessionSlot: () => undefined,
    updateStreaming: record('updateStreaming'),
    finalizeStreaming: record('finalizeStreaming'),
    appendRealtime: record('appendRealtime'),
    refreshFromServer: async (...args: unknown[]) => { calls.push(['refreshFromServer', ...args]); },
  } as unknown as SessionStore;
}

function Probe({ emit, store, calls, visibleSessionId }: { emit: { current: ((event: ServerEvent) => void) | null }; store: SessionStore; calls: Call[]; visibleSessionId: string }) {
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  useChatRealtimeHandlers({
    subscribe: (listener) => { emit.current = listener; return () => { emit.current = null; }; },
    provider: 'gjc',
    selectedSession: { id: visibleSessionId } as never,
    currentSessionId: visibleSessionId,
    setTokenBudget: (budget) => { calls.push(['setTokenBudget', budget]); },
    setSessionState: () => { calls.push(['setSessionState']); },
    onSteerResult: (...args) => { calls.push(['onSteerResult', ...args]); },
    onSessionProcessing: (...args) => { calls.push(['onSessionProcessing', ...args]); },
    onSessionIdle: (...args) => { calls.push(['onSessionIdle', ...args]); },
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef,
    accumulatedStreamRef,
    statusCheckSentAtRef,
    sessionStore: store,
  });
  // Match ChatInterface's cleanup order: the realtime hook can retain an
  // unpainted delta before the view clears its own accumulator.
  useEffect(() => () => {
    if (streamTimerRef.current) cancelAnimationFrame(streamTimerRef.current);
    streamTimerRef.current = null;
    accumulatedStreamRef.current = '';
  }, [visibleSessionId]);
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
    unmount: view.unmount,
    send: (event: ServerEvent) => act(() => { emit.current?.(event); }),
    switchTo: (id: string) => view.rerender(createElement(Probe, { ...props, visibleSessionId: id })),
  };
}

test('an answer that arrives whole on stream_end is shown without any delta', () => {
  const { calls, send } = mount();
  send({ kind: 'stream_end', sessionId: 'visible', timestamp: '2026-01-01T00:00:01Z', content: 'The moon is far.' } as ServerEvent);

  assert.deepEqual(calls, [
    ['updateStreaming', 'visible', 'The moon is far.', 'gjc', '2026-01-01T00:00:01Z'],
    ['finalizeStreaming', 'visible'],
  ]);
});

test('stream_end outranks the deltas a late viewer accumulated', async () => {
  const { calls, send } = mount();
  send({ kind: 'stream_delta', sessionId: 'visible', content: 'is far.' } as ServerEvent);
  await new Promise((resolve) => setTimeout(resolve, 150));
  send({ kind: 'stream_end', sessionId: 'visible', content: 'The moon is far.' } as ServerEvent);

  assert.deepEqual(calls, [
    ['updateStreaming', 'visible', 'is far.', 'gjc', undefined],
    ['updateStreaming', 'visible', 'The moon is far.', 'gjc', undefined],
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

  assert.deepEqual(calls.filter(([name, id]) => name === 'updateStreaming' && id === 'visible'), [
    ['updateStreaming', 'visible', 'Visible answer', 'gjc', undefined],
  ]);
  assert.equal(calls.filter(([name, id]) => name === 'updateStreaming' && id === 'background').length, 1);
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

test('repeated subscription replay finalizes an answer once and accepts a new run with reset sequence', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(useSessionStore, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  });
  const { send, switchTo } = mount(view.result.current);
  const end = { id: 'stream-end-1', kind: 'stream_end', sessionId: 'visible', replayGeneration: 'run-1', seq: 62, timestamp: '2026-01-01T00:00:01Z', content: 'The answer.' } as ServerEvent;
  send(end);
  switchTo('another');
  switchTo('visible');
  send(end);
  assert.equal(view.result.current.getMessages('visible').filter(row => row.content === 'The answer.').length, 1);
  // The server currently resets seq for every run: a different event ID must
  // still be admitted even when its sequence is below the previous turn's.
  send({ ...end, id: 'stream-end-2', replayGeneration: 'run-2', seq: 1, timestamp: '2026-01-01T00:01:01Z' });
  assert.equal(view.result.current.getMessages('visible').filter(row => row.content === 'The answer.').length, 2);
});

test('subscription high-water does not consume replay, and obsolete generations cannot change content or status', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(useSessionStore, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  });
  const store = view.result.current;
  const { send, switchTo, calls } = mount(store);
  send({ kind: 'stream_delta', id: 'old-delta', sessionId: 'visible', replayGeneration: 'old', seq: 80, content: 'Interrupted answer' });
  send({ kind: 'chat_subscribed', sessionId: 'visible', replayGeneration: 'new', lastSeq: 4, isProcessing: true });
  assert.deepEqual(store.getReplayCursor('visible'), { replayGeneration: 'new', lastSeq: 0 });
  // Navigating before the replay arrives must keep the unconsumed cursor.
  switchTo('another');
  switchTo('visible');
  assert.deepEqual(store.getReplayCursor('visible'), { replayGeneration: 'new', lastSeq: 0 });
  const delta = { kind: 'stream_delta', id: 'new-delta', sessionId: 'visible', replayGeneration: 'new', seq: 1, content: 'Current answer' };
  send(delta);
  send(delta);
  send({ kind: 'chat_subscribed', sessionId: 'visible', replayGeneration: 'new', lastSeq: 4, isProcessing: true });
  assert.deepEqual(store.getReplayCursor('visible'), { replayGeneration: 'new', lastSeq: 1 });
  const callCount = calls.length;
  send({ kind: 'complete', id: 'late-completion', sessionId: 'visible', replayGeneration: 'old', seq: 81, aborted: true });
  send({ kind: 'chat_subscribed', sessionId: 'visible', replayGeneration: 'old', lastSeq: 82, isProcessing: false });
  send({ kind: 'stream_delta', id: 'late-delta', sessionId: 'visible', replayGeneration: 'old', seq: 82, content: 'obsolete' });
  assert.equal(calls.length, callCount, 'obsolete completion and subscription cannot mark the new run idle');
  send({ kind: 'stream_end', id: 'new-end', sessionId: 'visible', replayGeneration: 'new', seq: 2 });
  assert.deepEqual(store.getMessages('visible').map(row => row.content), ['Interrupted answer', 'Current answer']);
  assert.deepEqual(store.getReplayCursor('visible'), { replayGeneration: 'new', lastSeq: 2 });

  // A process restart may report no active run before publishing a new UUID.
  send({ kind: 'chat_subscribed', sessionId: 'visible', replayGeneration: null, lastSeq: 0, isProcessing: false });
  send({ kind: 'chat_subscribed', sessionId: 'visible', replayGeneration: 'restarted', lastSeq: 7, isProcessing: true });
  assert.deepEqual(store.getReplayCursor('visible'), { replayGeneration: 'restarted', lastSeq: 0 });
  send({ kind: 'stream_end', id: 'restart-end', sessionId: 'visible', replayGeneration: 'restarted', seq: 1, content: 'After restart' });
  send(delta);
  assert.deepEqual(store.getMessages('visible').map(row => row.content), ['Interrupted answer', 'Current answer', 'After restart']);
  assert.deepEqual(store.getReplayCursor('visible'), { replayGeneration: 'restarted', lastSeq: 1 });
});

test('live generation changes separate unfinished visible and background deltas without a subscription', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(useSessionStore, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  });
  const store = view.result.current;
  const { send } = mount(store);
  for (const sessionId of ['visible', 'background']) {
    send({ kind: 'stream_delta', id: `${sessionId}-old`, sessionId, seq: 20, replayGeneration: 'old', content: 'Previous ' });
    send({ kind: 'stream_delta', id: `${sessionId}-new-1`, sessionId, seq: 1, replayGeneration: 'new', content: 'Next ' });
    send({ kind: 'stream_delta', id: `${sessionId}-new-2`, sessionId, seq: 2, replayGeneration: 'new', content: 'answer' });
    if (sessionId === 'visible') send({ kind: 'stream_end', id: 'end', sessionId, seq: 3, replayGeneration: 'new' });
    assert.deepEqual(store.getMessages(sessionId).map(row => row.content), ['Previous ', 'Next answer']);
  }
});

test('a cursor never skips an unpainted delta across navigation, background frames, or remount', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(useSessionStore, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  });
  const store = view.result.current;
  const mounted = mount(store, 'a');
  const common = { sessionId: 'a', replayGeneration: 'run', kind: 'stream_delta', timestamp: '2026-01-01T00:00:05Z' };
  mounted.send({ ...common, id: 'first', seq: 1, content: 'Before ' });
  mounted.switchTo('b');
  assert.equal(store.getMessages('a')[0]?.content, 'Before ', 'retain a delta before cancelling its paint');
  assert.equal(store.getMessages('a')[0]?.timestamp, common.timestamp);
  mounted.send({ ...common, id: 'background', seq: 2, content: 'during ' });
  mounted.switchTo('a');
  mounted.send({ ...common, id: 'returned', seq: 3, content: 'after ' });
  mounted.unmount();
  assert.deepEqual(store.getReplayCursor('a'), { replayGeneration: 'run', lastSeq: 3 });
  const remounted = mount(store, 'a');
  remounted.send({ ...common, id: 'remounted', seq: 4, content: 'remount.' });
  remounted.send({ ...common, id: 'end', kind: 'stream_end', seq: 5 });
  assert.deepEqual(store.getMessages('a').map(row => row.content), ['Before during after remount.']);
});

for (const historyFirst of [true, false]) {
  test(`Detailed density shows thinking_end reasoning once when history arrives ${historyFirst ? 'before' : 'after'} replay`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(useSessionStore, {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
    });
    const store = view.result.current;
    const { send } = mount(store);
    const common = { sessionId: 'visible', provider: 'gjc' as const, timestamp: '2026-01-01T00:00:05Z' };
    const history = { messages: [
      { ...common, id: 'disk-thinking', kind: 'thinking', content: 'Reasoned once.' },
      { ...common, id: 'disk-answer', kind: 'text', role: 'assistant', content: 'Final answer.' },
    ], total: 42, hasMore: true };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(history))) as typeof fetch;
    try {
      if (historyFirst) await act(async () => { await store.refreshFromServer('visible'); });
      // The SDK adapter emits kind:thinking for thinking_end, with a new
      // realtime ID rather than the persisted transcript's block ID.
      const thinking = { ...common, id: 'thinking-end', kind: 'thinking', seq: 1, replayGeneration: 'run', content: 'Reasoned once.' };
      send(thinking);
      send({ ...common, id: 'end', kind: 'stream_end', seq: 2, replayGeneration: 'run', content: 'Final answer.' });
      send(thinking);
      if (!historyFirst) await act(async () => { await store.refreshFromServer('visible'); });
      const messages = normalizedToChatMessages(store.getMessages('visible'));
      const getMessageKey = assignMessageKeys(messages);
      const rendered = render(createElement('div', {}, messages.map(message => createElement(MessageComponent, {
        key: getMessageKey(message), message, prevMessage: null, createDiff: () => [], density: 'detailed', provider: 'gjc',
      }))));
      assert.equal(rendered.getAllByText('Reasoned once.').length, 1);
      assert.equal(rendered.getAllByText('Final answer.').length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

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
