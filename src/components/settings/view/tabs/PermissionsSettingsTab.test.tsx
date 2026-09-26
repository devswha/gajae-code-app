import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CONFIGURED_PERMISSIONS_QUERY_KEY, type ProjectPermissions } from '../../../../hooks/useProjectPermissions';
import { PROJECTS_QUERY_KEY } from '../../../../hooks/useProjectsQuery';

import PermissionsSettingsTab from './PermissionsSettingsTab';

function render(configured: ProjectPermissions[] | undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (configured) client.setQueryData(CONFIGURED_PERMISSIONS_QUERY_KEY, configured);
  client.setQueryData(PROJECTS_QUERY_KEY, [
    { projectId: 'alpha', displayName: 'Alpha Workspace', fullPath: '/work/alpha' },
  ]);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PermissionsSettingsTab)));
}

test('while nothing has loaded the tab says so instead of describing the default', () => {
  const html = render(undefined);
  assert.match(html, /permissions\.loading/);
  assert.doesNotMatch(html, /permissions\.empty/);
});

test('no configured project means every project is on the default policy', () => {
  assert.match(render([]), /permissions\.empty/);
});

test('each configured project lists its mode, its always-allowed tools, and the ways back', () => {
  const html = render([
    { projectId: 'alpha', projectPath: '/work/alpha', mode: 'bypass', allowAlways: ['bash', 'eval'], updatedAt: null },
    { projectId: 'beta', projectPath: '/work/beta', mode: 'ask', allowAlways: ['edit'], updatedAt: null },
  ]);

  // Known projects are named; unknown ones fall back to the last path segment.
  assert.match(html, /Alpha Workspace/);
  assert.match(html, />beta</);
  // Every mode is drawn alike; bypass is the default, not a warning.
  assert.match(html, /class="[^"]*text-foreground"[^>]*data-mode="bypass"/);
  assert.match(html, /class="[^"]*text-foreground"[^>]*data-mode="ask"/);
  assert.doesNotMatch(html, /text-destructive"[^>]*data-mode=/);
  for (const tool of ['bash', 'eval', 'edit']) {
    assert.match(html, new RegExp(`<li[^>]*>${tool}<button`), tool);
  }
  assert.equal((html.match(/permissions\.resetToDefault/g) ?? []).length, 2, 'one reset per project');
  assert.equal((html.match(/permissions\.revokeTool/g) ?? []).length, 3, 'one revoke per allowed tool');
});
