import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { useConversationMessageSearch, useSessionMessageSearch } from './useSessionMessageSearch';

class SearchStream {
  static instances: SearchStream[] = [];
  closed = false;
  private listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(readonly url: string, readonly options?: EventSourceInit) { SearchStream.instances.push(this); }
  close() { this.closed = true; }
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  // Also deliver queued events after close, so stale-response guards are exercised.
  send(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    }));
  }
}

const originalEventSource = globalThis.EventSource;
beforeEach(() => {
  SearchStream.instances = [];
  globalThis.EventSource = SearchStream as unknown as typeof EventSource;
});
afterEach(() => { cleanup(); globalThis.EventSource = originalEventSource; });

const result = (projectId: string, sessionId = 'app-session') => ({
  projectResult: {
    projectId, projectName: '/workspace/project', projectDisplayName: 'Project',
    sessions: [{ sessionId, provider: 'gjc', sessionSummary: 'Review changes', matches: [{ snippet: '/skill:review user argument' }] }],
  },
});
const streamAt = async (index: number) => {
  await waitFor(() => assert.ok(SearchStream.instances[index]));
  return SearchStream.instances[index];
};

test('global conversation search accepts GJC results from every project and tolerates malformed events', async () => {
  const view = renderHook(() => useConversationMessageSearch('/skill:review', true));
  const stream = await streamAt(0);
  const params = new URL(stream.url, 'http://localhost').searchParams;
  assert.equal(params.get('q'), '/skill:review');
  assert.equal(params.has('projectId'), false);
  assert.equal(stream.options?.withCredentials, true);
  act(() => {
    stream.send('result', 'malformed JSON');
    stream.send('result', { projectResult: null });
    stream.send('result', result('project-one'));
    stream.send('result', result('project-two', 'app-two'));
    stream.send('done', {});
  });
  assert.deepEqual(view.result.current, [
    { sessionId: 'app-session', projectId: 'project-one', label: 'Review changes', snippet: '/skill:review user argument', provider: 'gjc' },
    { sessionId: 'app-two', projectId: 'project-two', label: 'Review changes', snippet: '/skill:review user argument', provider: 'gjc' },
  ]);
  assert.equal(stream.closed, true);
});

test('palette search sends the selected project to the server and keeps the defensive event filter', async () => {
  const projectId = 'project/id & scope';
  const view = renderHook(() => useSessionMessageSearch(projectId, 'needle', true));
  const stream = await streamAt(0);
  const params = new URL(stream.url, 'http://localhost').searchParams;
  assert.equal(params.get('projectId'), projectId);
  assert.equal(params.get('limit'), '50');
  act(() => {
    stream.send('result', result('other-project', 'other-session'));
    stream.send('result', result(projectId));
  });
  assert.deepEqual(view.result.current.map(({ sessionId }) => sessionId), ['app-session']);
});

test('changing project clears old hits and ignores events from the previous search', async () => {
  const view = renderHook(({ projectId }) => useSessionMessageSearch(projectId, 'needle', true), {
    initialProps: { projectId: 'first-project' },
  });
  const first = await streamAt(0);
  act(() => first.send('result', result('first-project')));
  assert.equal(view.result.current.length, 1);
  view.rerender({ projectId: 'second-project' });
  assert.equal(first.closed, true);
  assert.deepEqual(view.result.current, []);
  act(() => first.send('result', result('first-project', 'stale')));
  assert.deepEqual(view.result.current, []);
  const second = await streamAt(1);
  assert.equal(new URL(second.url, 'http://localhost').searchParams.get('projectId'), 'second-project');
  act(() => second.send('result', result('second-project', 'new-session')));
  assert.deepEqual(view.result.current.map(({ sessionId }) => sessionId), ['new-session']);
});

test('changing the query or disabling search invalidates pending responses and clears old hits', async () => {
  const view = renderHook(({ query, enabled }) => useConversationMessageSearch(query, enabled), {
    initialProps: { query: 'first', enabled: true },
  });
  const first = await streamAt(0);
  act(() => first.send('result', result('project')));
  view.rerender({ query: 'second', enabled: true });
  assert.deepEqual(view.result.current, []);
  assert.equal(first.closed, true);
  const second = await streamAt(1);
  act(() => second.send('result', result('project', 'second')));
  assert.equal(view.result.current.length, 1);
  view.rerender({ query: 'second', enabled: false });
  act(() => {
    first.send('result', result('project', 'old-first'));
    second.send('result', result('project', 'old-second'));
  });
  assert.equal(second.closed, true);
  assert.deepEqual(view.result.current, []);
});

test('short queries and an unselected palette create no stream, and unmount closes active search', async () => {
  const short = renderHook(() => useConversationMessageSearch('x', true));
  const unselected = renderHook(() => useSessionMessageSearch(undefined, 'needle', true));
  const active = renderHook(() => useConversationMessageSearch('needle', true));
  const stream = await streamAt(0);
  assert.equal(SearchStream.instances.length, 1);
  active.unmount();
  assert.equal(stream.closed, true);
  short.unmount();
  unselected.unmount();
});
