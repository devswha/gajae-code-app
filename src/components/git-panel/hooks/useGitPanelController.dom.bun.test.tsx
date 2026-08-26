import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';

import type { Project } from '../../../types/app';
import type { GitPanelController, GitPanelView } from '../types/types';

import { useGitPanelController } from './useGitPanelController';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function project(projectId: string): Project {
  return { projectId } as Project;
}

function Harness({ selectedProject, activeView, onController }: {
  selectedProject: Project | null;
  activeView: GitPanelView;
  onController: (controller: GitPanelController) => void;
}) {
  const controller = useGitPanelController({ selectedProject, activeView, onFileOpen: () => {} });
  onController(controller);
  return <output data-testid="state">{JSON.stringify({
    branch: controller.currentBranch,
    status: controller.gitStatus,
    operationError: controller.operationError,
    isPulling: controller.isPulling,
  })}</output>;
}

function renderHarness(projectId: string, activeView: GitPanelView, onController: (controller: GitPanelController) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness selectedProject={project(projectId)} activeView={activeView} onController={onController} />
    </QueryClientProvider>,
  );
}

async function withFetch(fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl as typeof globalThis.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
}

function readState(container: HTMLElement) {
  return JSON.parse(container.querySelector('[data-testid="state"]')!.textContent!);
}

function readProject(url: string) {
  return new URL(url, 'http://localhost').searchParams.get('project');
}

test('mount fetches repository reads but not commits outside history', async () => {
  const requests: string[] = [];
  await withFetch(async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/status')) return jsonResponse({ branch: 'main' });
    if (url.includes('/branches')) return jsonResponse({ branches: ['main'] });
    if (url.includes('/remote-status')) return jsonResponse({ hasRemote: true });
    return jsonResponse({ commits: [] });
  }, async () => {
    const rendered = renderHarness('one', 'changes', () => {});
    await waitFor(() => assert.equal(readState(rendered.container).branch, 'main'));
    assert.equal(requests.some((url) => url.includes('/status')), true);
    assert.equal(requests.some((url) => url.includes('/branches')), true);
    assert.equal(requests.some((url) => url.includes('/remote-status')), true);
    assert.equal(requests.some((url) => url.includes('/commits')), false);
  });
});

test('project key switching never exposes the previous project status', async () => {
  await withFetch(async (input) => {
    const url = String(input);
    const id = readProject(url);
    if (url.includes('/status')) return jsonResponse({ branch: id === 'one' ? 'one-branch' : 'two-branch' });
    if (url.includes('/branches')) return jsonResponse({ branches: [] });
    if (url.includes('/remote-status')) return jsonResponse({});
    return jsonResponse({ commits: [] });
  }, async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <Harness selectedProject={project('one')} activeView="changes" onController={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      const state = readState(rendered.container);
      assert.equal(state.status.branch, 'one-branch');
      assert.equal(state.branch, 'one-branch');
    });
    rendered.rerender(
      <QueryClientProvider client={queryClient}>
        <Harness selectedProject={project('two')} activeView="changes" onController={() => {}} />
      </QueryClientProvider>,
    );
    assert.equal(readState(rendered.container).status, null);
    await waitFor(() => assert.equal(readState(rendered.container).status.branch, 'two-branch'));
  });
});

test('stage waits for its status invalidation to fetch fresh data', async () => {
  let statusRequests = 0;
  let controller: GitPanelController | undefined;
  await withFetch(async (input) => {
    const url = String(input);
    if (url.includes('/status')) {
      statusRequests += 1;
      return jsonResponse({ branch: 'main' });
    }
    if (url.includes('/stage')) return jsonResponse({ success: true });
    if (url.includes('/branches')) return jsonResponse({ branches: [] });
    if (url.includes('/remote-status')) return jsonResponse({});
    return jsonResponse({});
  }, async () => {
    renderHarness('one', 'changes', (value) => { controller = value; });
    await waitFor(() => assert.equal(statusRequests, 1));
    let result = false;
    await act(async () => { result = await controller!.stageFiles(['file.ts']); });
    assert.equal(result, true);
    assert.equal(statusRequests, 2);
  });
});

test('status errors are query data and clear the current branch', async () => {
  await withFetch(async (input) => {
    const url = String(input);
    if (url.includes('/status')) return jsonResponse({ error: 'not a repository', details: 'missing .git' });
    if (url.includes('/branches')) return jsonResponse({ branches: [] });
    if (url.includes('/remote-status')) return jsonResponse({});
    return jsonResponse({});
  }, async () => {
    const rendered = renderHarness('one', 'changes', () => {});
    await waitFor(() => {
      const state = readState(rendered.container);
      assert.equal(state.status.error, 'not a repository');
      assert.equal(state.branch, '');
    });
  });
});

test('pull failure reports error and success refreshes status and remote status', async () => {
  let pullSucceeds = false;
  let statusRequests = 0;
  let remoteRequests = 0;
  let controller: GitPanelController | undefined;
  await withFetch(async (input) => {
    const url = String(input);
    if (url.includes('/status')) { statusRequests += 1; return jsonResponse({ branch: 'main' }); }
    if (url.includes('/remote-status')) { remoteRequests += 1; return jsonResponse({}); }
    if (url.includes('/branches')) return jsonResponse({ branches: [] });
    if (url.includes('/pull')) return jsonResponse(pullSucceeds ? { success: true } : { success: false, error: 'pull rejected' });
    return jsonResponse({});
  }, async () => {
    const rendered = renderHarness('one', 'changes', (value) => { controller = value; });
    await waitFor(() => assert.equal(statusRequests, 1));
    await act(async () => { await controller!.handlePull(); });
    await waitFor(() => {
      const state = readState(rendered.container);
      assert.equal(state.operationError, 'pull rejected');
      assert.equal(state.isPulling, false);
    });
    pullSucceeds = true;
    await act(async () => { await controller!.handlePull(); });
    await waitFor(() => {
      assert.equal(statusRequests >= 2, true);
      assert.equal(remoteRequests >= 2, true);
    });
  });
});

test('history activation enables commits query', async () => {
  const requests: string[] = [];
  await withFetch(async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/status')) return jsonResponse({ branch: 'main' });
    if (url.includes('/branches')) return jsonResponse({ branches: [] });
    if (url.includes('/remote-status')) return jsonResponse({});
    return jsonResponse({ commits: [] });
  }, async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <Harness selectedProject={project('one')} activeView="changes" onController={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => assert.equal(requests.some((url) => url.includes('/status')), true));
    assert.equal(requests.some((url) => url.includes('/commits')), false);
    rendered.rerender(
      <QueryClientProvider client={queryClient}>
        <Harness selectedProject={project('one')} activeView="history" onController={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => assert.equal(requests.some((url) => url.includes('/commits')), true));
  });
});
