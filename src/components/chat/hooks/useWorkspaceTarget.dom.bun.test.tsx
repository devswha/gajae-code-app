import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import type { Project, ProjectSession } from '../../../types/app';

import { useWorkspaceTarget } from './useWorkspaceTarget';

/*
 * The hook drives two networked probes an effect apart (the empty-text mount
 * probe, then a 300ms-debounced re-query as the user types) and a pin that
 * survives some state changes but not others. None of that is reachable from
 * a static render, so this drives the real hook against a mocked fetch.
 */

const project: Project = {
  projectId: 'proj-workspace',
  displayName: 'Projects',
  fullPath: '/Users/dev/Projects',
  origin: 'explicit',
};

const session = (id: string): ProjectSession => ({ id } as ProjectSession);

const candidateA = { path: '/Users/dev/Projects/repo-a', name: 'repo-a', score: 100, reason: 'mention' as const };
const candidateB = { path: '/Users/dev/Projects/repo-b', name: 'repo-b', score: 40, reason: 'partial' as const };

type FetchCall = { url: string };

function installFetch(responder: (call: FetchCall) => { isWorkspace: boolean; candidates: unknown[] }) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    calls.push({ url });
    const data = responder({ url });
    return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const composer = (overrides: Partial<Parameters<typeof useWorkspaceTarget>[0]> = {}) =>
  renderHook(
    (props: Partial<Parameters<typeof useWorkspaceTarget>[0]>) => useWorkspaceTarget({
      selectedProject: project,
      selectedSession: null,
      currentSessionId: null,
      input: '',
      ...props,
    } as never),
    { initialProps: overrides },
  );

afterEach(cleanup);

test('a non-workspace project resolves once on mount and stays inert', async () => {
  const fetch = installFetch(() => ({ isWorkspace: false, candidates: [] }));
  try {
    const view = composer();
    await waitFor(() => assert.equal(fetch.calls.length, 1));
    assert.match(fetch.calls[0].url, /\/api\/projects\/proj-workspace\/resolve-target\?text=$/);
    assert.equal(view.result.current.isWorkspace, false);
    assert.equal(view.result.current.target, null);
  } finally {
    fetch.restore();
  }
});

test('a workspace project auto-targets the top candidate once its score clears the threshold', async () => {
  const fetch = installFetch(({ url }) => {
    const text = new URL(url, 'http://local').searchParams.get('text') ?? '';
    if (!text) return { isWorkspace: true, candidates: [] };
    return { isWorkspace: true, candidates: [candidateA, candidateB] };
  });
  try {
    const view = composer();
    await waitFor(() => assert.equal(view.result.current.isWorkspace, true));

    view.rerender({ input: 'fix repo-a bug' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    await waitFor(() => assert.equal(view.result.current.target?.name, 'repo-a'));
    assert.equal(view.result.current.pinned, false);
  } finally {
    fetch.restore();
  }
});

test('a candidate below the auto-target threshold is offered but not auto-selected', async () => {
  const fetch = installFetch(({ url }) => {
    const text = new URL(url, 'http://local').searchParams.get('text') ?? '';
    if (!text) return { isWorkspace: true, candidates: [] };
    return { isWorkspace: true, candidates: [candidateB] };
  });
  try {
    const view = composer();
    await waitFor(() => assert.equal(view.result.current.isWorkspace, true));

    view.rerender({ input: 'repo' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    await waitFor(() => assert.equal(view.result.current.candidates.length, 1));
    assert.equal(view.result.current.target, null);
  } finally {
    fetch.restore();
  }
});

test('a user pick sticks through further typing until the input clears', async () => {
  const fetch = installFetch(({ url }) => {
    const text = new URL(url, 'http://local').searchParams.get('text') ?? '';
    if (!text) return { isWorkspace: true, candidates: [] };
    return { isWorkspace: true, candidates: [candidateA, candidateB] };
  });
  try {
    const view = composer();
    await waitFor(() => assert.equal(view.result.current.isWorkspace, true));

    act(() => { view.result.current.pickTarget(candidateB); });
    assert.equal(view.result.current.pinned, true);
    assert.equal(view.result.current.target?.name, 'repo-b');

    // Later typing resolves repo-a as the top candidate, but the pin wins.
    view.rerender({ input: 'now about repo-a' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    await waitFor(() => assert.equal(view.result.current.candidates.length, 2));
    assert.equal(view.result.current.target?.name, 'repo-b', 'the pinned pick is not overridden by later typing');

    view.rerender({ input: '' });
    assert.equal(view.result.current.pinned, false, 'the pin releases immediately once the box empties');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    await waitFor(() => assert.equal(view.result.current.target, null));
  } finally {
    fetch.restore();
  }
});

test('establishing a session releases the pin', async () => {
  const fetch = installFetch(({ url }) => {
    const text = new URL(url, 'http://local').searchParams.get('text') ?? '';
    if (!text) return { isWorkspace: true, candidates: [] };
    return { isWorkspace: true, candidates: [candidateA] };
  });
  try {
    const view = composer({ input: 'repo-a work' });
    await waitFor(() => assert.equal(view.result.current.isWorkspace, true));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)); });
    act(() => { view.result.current.pickTarget(candidateA); });
    assert.equal(view.result.current.pinned, true);

    view.rerender({ input: 'repo-a work', selectedSession: session('s1') });
    assert.equal(view.result.current.pinned, false);
    assert.equal(view.result.current.target, null);
  } finally {
    fetch.restore();
  }
});

test('resolveForSend authoritatively resolves submitted text before preview completes', async () => {
  const fetch = installFetch(({ url }) => {
    const text = new URL(url, 'http://local').searchParams.get('text') ?? '';
    return { isWorkspace: true, candidates: text ? [candidateA] : [] };
  });
  try {
    const view = composer();
    const target = await view.result.current.resolveForSend('exact submitted text');
    assert.equal(target?.name, 'repo-a');
    assert.equal(new URL(fetch.calls[1].url, 'http://local').searchParams.get('text'), 'exact submitted text');
    assert.equal(view.result.current.isWorkspace, false);
  } finally {
    fetch.restore();
  }
});

test('resolveForSend honors a pinned root target without fetching', async () => {
  const fetch = installFetch(() => ({ isWorkspace: true, candidates: [] }));
  try {
    const view = composer();
    await waitFor(() => assert.equal(fetch.calls.length, 1));
    act(() => { view.result.current.pickTarget(null); });
    assert.equal(await view.result.current.resolveForSend('repo-a'), null);
    assert.equal(fetch.calls.length, 1);
  } finally {
    fetch.restore();
  }
});

test('resolveForSend throws on an unsuccessful response', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
  try {
    const view = composer();
    await assert.rejects(() => view.result.current.resolveForSend('repo-a'), /503/);
  } finally {
    globalThis.fetch = original;
  }
});

test('a late response from a previous project cannot overwrite the current project', async () => {
  const original = globalThis.fetch;
  let resolveA: ((response: Response) => void) | undefined;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes('proj-workspace')) return new Promise<Response>((resolve) => { resolveA = resolve; });
    return Promise.resolve(new Response(JSON.stringify({ data: { isWorkspace: true, candidates: [candidateB] } }), { status: 200 }));
  }) as typeof fetch;
  try {
    const view = composer();
    view.rerender({ selectedProject: { ...project, projectId: 'proj-b' } });
    await waitFor(() => assert.equal(view.result.current.candidates[0]?.name, 'repo-b'));
    await act(async () => { resolveA?.(new Response(JSON.stringify({ data: { isWorkspace: true, candidates: [candidateA] } }), { status: 200 })); });
    assert.equal(view.result.current.candidates[0]?.name, 'repo-b');
  } finally {
    globalThis.fetch = original;
  }
});
