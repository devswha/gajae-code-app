import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { useSessionStore, type SessionStore } from './useSessionStore';

type PendingRequest = {
  url: string;
  resolve: (response: Response) => void;
};

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

function createStore(): SessionStore {
  let store: SessionStore | undefined;
  function StoreHarness() {
    store = useSessionStore();
    return null;
  }
  renderToStaticMarkup(createElement(StoreHarness));
  assert.ok(store);
  return store;
}

test('fetchMore serializes a captured offset and deduplicates only matching message ids', async () => {
  const originalFetch = globalThis.fetch;
  const pending: PendingRequest[] = [];
  globalThis.fetch = ((url: string) => new Promise<Response>((resolve) => {
    pending.push({ url, resolve });
  })) as typeof fetch;

  try {
    const store = createStore();
    const initial = store.fetchFromServer('session', { limit: 2 });
    pending.shift()!.resolve(response({
      messages: [
        { id: 'new-1', sessionId: 'session', timestamp: '2026-01-01T00:01:00Z', kind: 'text', provider: 'claude' },
        { id: 'new-2', sessionId: 'session', timestamp: '2026-01-01T00:02:00Z', kind: 'text', provider: 'claude' },
      ],
      total: 4,
      hasMore: true,
    }));
    await initial;

    const firstPage = store.fetchMore('session');
    const duplicatePage = store.fetchMore('session');
    assert.equal(pending.length, 1, 'only one request may use the captured offset');
    assert.match(pending[0].url, /offset=2/);

    pending.shift()!.resolve(response({
      messages: [
        { id: 'old-1', sessionId: 'session', timestamp: '2026-01-01T00:00:00Z', kind: 'text', provider: 'claude' },
        { id: 'new-1', sessionId: 'session', timestamp: '2026-01-01T00:01:00Z', kind: 'text', provider: 'claude' },
      ],
      total: 4,
      hasMore: false,
    }));
    await Promise.all([firstPage, duplicatePage]);

    const slot = store.getSessionSlot('session')!;
    assert.deepEqual(slot.serverMessages.map(message => message.id), ['old-1', 'new-1', 'new-2']);
    assert.equal(slot.offset, 4, 'the offset advances by the accepted response window');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('newer accepted pagination and refresh settle loading and reset the pagination offset', async () => {
  const originalFetch = globalThis.fetch;
  const pending: PendingRequest[] = [];
  globalThis.fetch = ((url: string) => new Promise<Response>((resolve) => {
    pending.push({ url, resolve });
  })) as typeof fetch;

  try {
    const store = createStore();
    const initial = store.fetchFromServer('session', { limit: 2 });
    pending.shift()!.resolve(response({
      messages: [{ id: 'a', sessionId: 'session', timestamp: '2026-01-01T00:00:00Z', kind: 'text', provider: 'claude' }],
      total: 2,
      hasMore: true,
    }));
    await initial;

    const supersededFullFetch = store.fetchFromServer('session', { limit: 2 });
    const page = store.fetchMore('session');
    assert.equal(store.getSessionSlot('session')!.status, 'loading');
    assert.equal(pending.length, 2);
    const [fullRequest, pageRequest] = pending.splice(0);
    pageRequest.resolve(response({
      messages: [{ id: 'older', sessionId: 'session', timestamp: '2025-12-31T23:59:00Z', kind: 'text', provider: 'claude' }],
      total: 2,
      hasMore: false,
    }));
    await page;
    assert.equal(store.getSessionSlot('session')!.status, 'idle');

    fullRequest.resolve(response({
      messages: [{ id: 'stale', sessionId: 'session', timestamp: '2026-01-01T00:00:00Z', kind: 'text', provider: 'claude' }],
      total: 1,
      hasMore: false,
    }));
    await supersededFullFetch;
    assert.deepEqual(store.getSessionSlot('session')!.serverMessages.map(message => message.id), ['older', 'a']);

    const refresh = store.refreshFromServer('session');
    pending.shift()!.resolve(response({
      messages: [
        { id: 'r1', sessionId: 'session', timestamp: '2026-01-01T00:00:00Z', kind: 'text', provider: 'claude' },
        { id: 'r1', sessionId: 'session', timestamp: '2026-01-01T00:01:00Z', kind: 'text', provider: 'claude' },
        { id: 'r2', sessionId: 'session', timestamp: '2026-01-01T00:02:00Z', kind: 'text', provider: 'claude' },
      ],
      total: 3,
      hasMore: true,
    }));
    await refresh;
    const slot = store.getSessionSlot('session')!;
    assert.deepEqual(slot.serverMessages.map(message => message.id), ['r1', 'r2']);
    assert.equal(slot.offset, 3, 'refresh offset follows the replacement response window');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('inactive session slots are LRU-bounded while active and streaming slots survive until clear', () => {
  const store = createStore();
  store.getSlot('active');
  store.setActiveSession('active');
  store.getSlot('streaming').status = 'streaming';
  for (let index = 0; index < 60; index++) {
    store.getSlot(`inactive-${index}`);
  }

  assert.ok(store.getSessionSlot('active'));
  assert.ok(store.getSessionSlot('streaming'));
  assert.equal(store.getSessionSlot('inactive-0'), undefined);

  store.clear();
  assert.equal(store.has('active'), false);
  assert.equal(store.has('streaming'), false);
});

test('persisted assistant rows with distinct ids are preserved and realtime replay is idempotent', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => response({
    messages: [
      {
        id: 'assistant-1',
        sessionId: 'session',
        timestamp: '2026-01-01T00:00:00Z',
        kind: 'text',
        role: 'assistant',
        content: 'same answer',
        provider: 'claude',
      },
      {
        id: 'assistant-2',
        sessionId: 'session',
        timestamp: '2026-01-01T00:01:00Z',
        kind: 'text',
        role: 'assistant',
        content: 'same answer',
        provider: 'claude',
      },
      {
        id: '',
        sessionId: 'session',
        timestamp: '2026-01-01T00:01:30Z',
        kind: 'text',
        role: 'assistant',
        content: 'legacy server row',
        provider: 'claude',
      },
    ],
    total: 3,
    hasMore: false,
  })) as typeof fetch;

  try {
    const store = createStore();
    await store.fetchFromServer('session');
    assert.deepEqual(
      store.getSessionSlot('session')!.merged.map(message => message.id),
      ['assistant-1', 'assistant-2', ''],
    );

    const realtimeMessage = {
      id: 'realtime-1',
      sessionId: 'session',
      timestamp: '2026-01-01T00:02:00Z',
      kind: 'tool_use' as const,
      provider: 'claude' as const,
    };
    store.appendRealtime('session', realtimeMessage);
    store.appendRealtimeBatch('session', [realtimeMessage, realtimeMessage]);

    assert.equal(
      store.getSessionSlot('session')!.realtimeMessages.filter(message => message.id === 'realtime-1').length,
      1,
    );

    store.appendRealtime('session', {
      id: '',
      sessionId: 'session',
      timestamp: '2026-01-01T00:03:00Z',
      kind: 'text',
      role: 'assistant',
      content: 'distinct realtime row',
      provider: 'claude',
    });
    assert.deepEqual(
      store.getSessionSlot('session')!.merged
        .filter(message => message.id === '')
        .map(message => message.content),
      ['legacy server row', 'distinct realtime row'],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('server fetch cannot overwrite streaming status and pending slots resist LRU eviction', async () => {
  const originalFetch = globalThis.fetch;
  let resolveRequest: ((response: Response) => void) | undefined;
  globalThis.fetch = (() => new Promise<Response>((resolve) => {
    resolveRequest = resolve;
  })) as typeof fetch;

  try {
    const store = createStore();
    store.setStatus('pending', 'streaming');
    const fetchRequest = store.fetchFromServer('pending');

    for (let index = 0; index < 60; index++) {
      store.getSlot(`inactive-${index}`);
    }
    assert.ok(store.getSessionSlot('pending'));

    assert.ok(resolveRequest);
    resolveRequest(response({ messages: [], total: 0, hasMore: false }));
    await fetchRequest;
    assert.equal(store.getSessionSlot('pending')?.status, 'streaming');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a request protects a newly created slot before saturated LRU trimming', async () => {
  const originalFetch = globalThis.fetch;
  let resolveRequest: ((response: Response) => void) | undefined;
  globalThis.fetch = (() => new Promise<Response>((resolve) => {
    resolveRequest = resolve;
  })) as typeof fetch;

  try {
    const store = createStore();
    for (let index = 0; index < 50; index++) {
      store.getSlot(`streaming-${index}`).status = 'streaming';
    }
    store.appendRealtime('realtime-overflow', {
      id: 'overflow-message',
      sessionId: 'realtime-overflow',
      timestamp: '2026-01-01T00:00:00Z',
      kind: 'text',
      role: 'assistant',
      content: 'retained',
      provider: 'claude',
    });
    assert.equal(
      store.getSessionSlot('realtime-overflow')?.realtimeMessages[0]?.id,
      'overflow-message',
    );

    const request = store.fetchFromServer('new-pending');
    assert.ok(store.getSessionSlot('new-pending'));
    assert.ok(resolveRequest);
    resolveRequest(response({ messages: [], total: 0, hasMore: false }));
    await request;
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Regression: the store signals changes by bumping an internal tick (a
// re-render) while its object identity stays stable, so consumers must read
// getMessages() fresh on every render instead of memoizing on the store
// identity. The chat pane once froze on its pre-fetch empty window because a
// useMemo keyed on [sessionId, sessionStore] never recomputed after the
// fetch landed. These assertions pin the two halves of that contract.
test('getMessages reflects a completed fetch and keeps empty reads identity-stable', async () => {
  const originalFetch = globalThis.fetch;
  let resolveRequest: ((response: Response) => void) | undefined;
  globalThis.fetch = (() => new Promise<Response>((resolve) => {
    resolveRequest = resolve;
  })) as typeof fetch;

  try {
    const store = createStore();
    store.setActiveSession('session');

    // Empty reads (unknown session, pre-fetch) share one stable identity so
    // per-render reads do not churn downstream memos.
    assert.equal(store.getMessages('missing'), store.getMessages('missing'));
    const preFetch = store.getMessages('session');
    assert.equal(preFetch.length, 0);
    assert.equal(store.getMessages('session'), preFetch);

    const request = store.fetchFromServer('session', { limit: 20, offset: 0 });
    assert.ok(resolveRequest);
    resolveRequest(response({
      messages: [
        { id: 'm-1', sessionId: 'session', timestamp: '2026-01-01T00:00:00Z', kind: 'text', role: 'user', content: 'hi', provider: 'gjc' },
        { id: 'm-2', sessionId: 'session', timestamp: '2026-01-01T00:01:00Z', kind: 'text', role: 'assistant', content: 'hello', provider: 'gjc' },
      ],
      total: 2,
      hasMore: false,
    }));
    await request;

    // A fresh read after the fetch settles must expose the loaded window —
    // no other invalidation signal exists for render-time consumers.
    const postFetch = store.getMessages('session');
    assert.equal(postFetch.length, 2);
    assert.equal(postFetch[0]?.id, 'm-1');
    assert.notEqual(postFetch, preFetch, 'loaded window replaces the empty identity');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
