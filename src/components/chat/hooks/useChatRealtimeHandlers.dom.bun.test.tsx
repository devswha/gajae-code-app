import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, render } from '@testing-library/react';
import { createElement, useRef } from 'react';

import type { ServerEvent } from '../../../contexts/WebSocketContext';
import type { SessionStore } from '../../../stores/useSessionStore';

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

function Probe({ emit, store }: { emit: { current: ((event: ServerEvent) => void) | null }; store: SessionStore }) {
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  const lastSeqRef = useRef(new Map<string, number>());
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  useChatRealtimeHandlers({
    subscribe: (listener) => { emit.current = listener; return () => { emit.current = null; }; },
    provider: 'gjc',
    selectedSession: { id: 'visible' } as never,
    currentSessionId: 'visible',
    setTokenBudget: () => {},
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

function mount() {
  const calls: Call[] = [];
  const emit: { current: ((event: ServerEvent) => void) | null } = { current: null };
  render(createElement(Probe, { emit, store: fakeStore(calls) }));
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
