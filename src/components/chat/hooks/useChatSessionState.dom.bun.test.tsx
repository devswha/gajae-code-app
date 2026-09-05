import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

import { useSessionStore, type NormalizedMessage, type SessionSlot, type SessionStore } from '../../../stores/useSessionStore';
import type { Project, ProjectSession } from '../../../types/app';

import { useChatSessionState } from './useChatSessionState';

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });
const project = { projectId: 'project', fullPath: '/repo', displayName: 'Repo' } as Project;
const empty: NormalizedMessage[] = [];
const noop = () => {};
const page = (total: number, hasMore = false): SessionSlot => ({
  total, hasMore, tokenUsage: { used: total }, serverMessages: [{ id: `m-${total}` }],
}) as SessionSlot;

function mount() {
  const pending: Array<{ id: string; resolve: (slot: SessionSlot) => void }> = [];
  const usage: Array<{ url: string; resolve: (response: Response) => void }> = [];
  globalThis.fetch = ((url: string) => new Promise<Response>((resolve) => { usage.push({ url, resolve }); })) as typeof fetch;
  const fetchPage = (id: string) => new Promise<SessionSlot>((resolve) => { pending.push({ id, resolve }); });
  const store = {
    getMessages: () => empty,
    has: () => true,
    isStale: () => false,
    setActiveSession: noop,
    fetchFromServer: fetchPage,
    fetchMore: fetchPage,
  } as unknown as SessionStore;
  const statusCheckSentAtRef = { current: new Map<string, number>() };
  const view = renderHook(({ id }: { id: string | null }) => useChatSessionState({
    selectedProject: project,
    selectedSession: id ? { id } as ProjectSession : null,
    ws: null, sendMessage: noop, resetStreamingState: noop,
    sessionStore: store, statusCheckSentAtRef,
  }), { initialProps: { id: 'a' as string | null } });
  const resolvePage = async (index: number, slot: SessionSlot) => {
    await act(async () => { pending.splice(index, 1)[0].resolve(slot); });
  };
  return { ...view, pending, usage, resolvePage };
}

test('a late initial history response cannot replace the next session pagination or budget', async () => {
  const view = mount();
  view.rerender({ id: 'b' });
  await view.resolvePage(1, page(2));
  await view.resolvePage(0, page(100, true));
  assert.equal(view.result.current.totalMessages, 2);
  assert.equal(view.result.current.hasMoreMessages, false);
  assert.deepEqual(view.result.current.tokenBudget, { used: 2 });
});

test('the loading indicator belongs to the pending session, not an old response', async () => {
  const view = mount();
  view.rerender({ id: 'b' });
  await view.resolvePage(0, page(100, true));
  assert.equal(view.result.current.isLoadingSessionMessages, true);
  await view.resolvePage(0, page(2));
  assert.equal(view.result.current.isLoadingSessionMessages, false);
});

test('late token usage success and failure cannot update another session', async () => {
  const view = mount();
  view.rerender({ id: 'b' });
  await act(async () => { view.usage[1].resolve(new Response(JSON.stringify({ used: 2 }))); });
  await act(async () => { view.usage[0].resolve(new Response(JSON.stringify({ used: 100 }))); });
  assert.deepEqual(view.result.current.tokenBudget, { used: 2 });

  view.rerender({ id: 'c' });
  view.rerender({ id: 'd' });
  await act(async () => { view.usage[3].resolve(new Response(JSON.stringify({ used: 4 }))); });
  await act(async () => { view.usage[2].resolve(new Response('{}', { status: 404 })); });
  assert.deepEqual(view.result.current.tokenBudget, { used: 4 });
});

test('an old load-all response cannot finish a new load-all request after switching away and back', async () => {
  const view = mount();
  await view.resolvePage(0, page(20, true));
  let first: Promise<void>;
  act(() => { first = view.result.current.loadAllMessages(); });
  view.rerender({ id: 'b' });
  await view.resolvePage(1, page(2));
  view.rerender({ id: 'a' });
  await view.resolvePage(1, page(20, true));
  let second: Promise<void>;
  act(() => { second = view.result.current.loadAllMessages(); });
  await view.resolvePage(0, page(100));
  await first!;
  assert.equal(view.result.current.isLoadingAllMessages, true);
  assert.equal(view.result.current.allMessagesLoaded, false);
  assert.equal(view.result.current.totalMessages, 20);
  await view.resolvePage(0, page(101));
  await second!;
  assert.equal(view.result.current.totalMessages, 101);
});

test('an old pagination request cannot change a new session or block its own pagination', async () => {
  const view = mount();
  await view.resolvePage(0, page(100, true));
  view.result.current.scrollContainerRef.current = document.createElement('div');
  let first: Promise<void>;
  act(() => { first = view.result.current.handleScroll(); });
  view.rerender({ id: 'b' });
  await view.resolvePage(1, page(50, true));
  let second: Promise<void>;
  act(() => { second = view.result.current.handleScroll(); });
  assert.deepEqual(view.pending.map(({ id }) => id), ['a', 'b']);
  await view.resolvePage(0, page(100));
  await first!;
  assert.equal(view.result.current.isLoadingMoreMessages, true);
  assert.equal(view.result.current.totalMessages, 50);
  await view.resolvePage(0, page(50));
  await second!;
  assert.equal(view.result.current.hasMoreMessages, false);
});

test('subscription cursors survive A → B → A, reconnect, and remount with the shared store', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ messages: [], total: 0, hasMore: false }))) as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const shared = renderHook(useSessionStore, {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  });
  const store = shared.result.current;
  store.trackReplayFrame('a', { seq: 80, replayGeneration: 'a-first' });
  store.trackReplayFrame('b', { seq: 3, replayGeneration: 'b-first' });
  const sent: unknown[] = [];
  const sendMessage = (message: unknown) => { sent.push(message); };
  const statusCheckSentAtRef = { current: new Map<string, number>() };
  const mountSubscriber = () => renderHook(({ id, socket }) => useChatSessionState({
    selectedProject: project, selectedSession: { id } as ProjectSession, ws: socket,
    sendMessage, resetStreamingState: noop, sessionStore: store, statusCheckSentAtRef,
  }), { initialProps: { id: 'a', socket: {} as WebSocket } });
  const expectCursor = (sessionId: string, replayGeneration: string, lastSeq: number) => {
    assert.deepEqual(sent.at(-1), { type: 'chat.subscribe', sessions: [{ sessionId, replayGeneration, lastSeq }] });
  };
  const view = mountSubscriber();
  await act(async () => {});
  expectCursor('a', 'a-first', 80);
  view.rerender({ id: 'b', socket: {} as WebSocket });
  await act(async () => {});
  expectCursor('b', 'b-first', 3);
  store.trackReplayFrame('a', { kind: 'chat_subscribed', replayGeneration: 'a-next' });
  store.trackReplayFrame('a', { seq: 1, replayGeneration: 'a-next' });
  view.rerender({ id: 'a', socket: {} as WebSocket });
  await act(async () => {});
  expectCursor('a', 'a-next', 1);
  sent.length = 0;
  view.rerender({ id: 'a', socket: {} as WebSocket });
  expectCursor('a', 'a-next', 1);
  view.unmount();
  mountSubscriber();
  await act(async () => {});
  expectCursor('a', 'a-next', 1);
  assert.deepEqual(store.getReplayCursor('b'), { replayGeneration: 'b-first', lastSeq: 3 });
});
