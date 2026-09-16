import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import { AuthProvider } from '../components/auth/context/AuthContext';

import { useWebSocket, WebSocketProvider } from './WebSocketContext';

const originalSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
const sockets: TestSocket[] = [];
class TestSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror = null;
  sent: string[] = [];
  failing = false;
  constructor() { sockets.push(this); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); }
  send(value: string) {
    if (this.failing) throw new Error('Socket closed during send');
    this.sent.push(value);
  }
}
afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalSocket;
  globalThis.fetch = originalFetch;
  sockets.length = 0;
});

test('send reports whether the current socket accepted the frame', async () => {
  globalThis.WebSocket = TestSocket as unknown as typeof WebSocket;
  globalThis.fetch = async () => new Response(JSON.stringify({ user: { id: 'owner', username: 'owner' } }));
  const view = renderHook(useWebSocket, {
    wrapper: ({ children }: { children: ReactNode }) => createElement(AuthProvider, null, createElement(WebSocketProvider, null, children)),
  });
  await waitFor(() => assert.equal(sockets.length, 1));
  const frame = { type: 'chat.send', sessionId: 'a', content: 'draft' };
  assert.equal(view.result.current.sendMessage(frame), false);
  act(() => { sockets[0].readyState = 1; sockets[0].onopen?.(); });
  assert.equal(view.result.current.sendMessage(frame), true);
  assert.deepEqual(sockets[0].sent.map((value) => JSON.parse(value)), [frame]);
  sockets[0].failing = true;
  assert.equal(view.result.current.sendMessage(frame), false);
});

test('a job failure reaches its subscriber even before the subscription is confirmed', async () => {
  // A rejected subscribe has no subscription id to match on. Dropping it left
  // the job panel spinning with nothing to explain why.
  globalThis.WebSocket = TestSocket as unknown as typeof WebSocket;
  globalThis.fetch = async () => new Response(JSON.stringify({ user: { id: 'owner', username: 'owner' } }));
  const view = renderHook(useWebSocket, {
    wrapper: ({ children }: { children: ReactNode }) => createElement(AuthProvider, null, createElement(WebSocketProvider, null, children)),
  });
  await waitFor(() => assert.equal(sockets.length, 1));
  act(() => { sockets[0].readyState = 1; sockets[0].onopen?.(); });

  const errors: string[] = [];
  act(() => {
    view.result.current.registerJobSubscription({
      jobId: 'job-a',
      getCursor: () => 0,
      onSubscribed: () => {},
      applyReplayChunk: () => true,
      applyLiveEvent: () => true,
      onError: (code) => { errors.push(code); },
    });
  });

  act(() => {
    sockets[0].onmessage?.({ data: JSON.stringify({ protocolVersion: 1, kind: 'gjc_job_error', code: 'authority_unavailable', retryable: true, message: 'authority_unavailable', jobId: 'job-a' }) });
  });
  assert.deepEqual(errors, ['authority_unavailable']);

  act(() => {
    sockets[0].onmessage?.({ data: JSON.stringify({ protocolVersion: 1, kind: 'gjc_job_error', code: 'not_found', retryable: false, message: 'not_found', jobId: 'other-job' }) });
  });
  assert.deepEqual(errors, ['authority_unavailable'], 'another job\u2019s failure is not this subscriber\u2019s');
});
