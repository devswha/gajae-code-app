import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { ProjectChange } from '../hooks/useProjectChanges';

import WorkspaceChangesTab, { ChangeRow, type WorkspaceChangesTabProps } from './WorkspaceChangesTab';

const t = (key: string) => key;
const changedFile: ProjectChange = {
  path: 'src/new-name.ts',
  oldPath: 'src/old-name.ts',
  status: 'renamed',
  staged: false,
  additions: 2,
  deletions: 1,
  patch: '@@ -1 +1,2 @@\n-old\n+new\n+another',
  binary: false,
  tooLarge: false,
};

function render(overrides: Partial<WorkspaceChangesTabProps> = {}): string {
  const client = new QueryClient();
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(WorkspaceChangesTab, {
      projectId: 'project-alpha',
      projectPath: '/work/alpha',
      projectName: 'Alpha Workspace',
      active: true,
      ...overrides,
    }),
  ));
}

test('renders the loading state and refresh control before a static render can load changes', () => {
  const html = render();

  assert.match(html, /workspace\.changes\.loading/);
  assert.match(html, /aria-label="workspace\.changes\.refreshLabel"/);
  assert.match(html, /workspace\.changes\.scope\.workingTree/);
  assert.match(html, /workspace\.changes\.scope\.lastTurn/);
});

test('renders a file row with counts, rename, and expanded unified diff', () => {
  const html = renderToStaticMarkup(createElement(ChangeRow, {
    file: changedFile,
    expanded: true,
    onToggle: () => {},
    onOpenInEditor: () => {},
    t,
  }));

  assert.match(html, /src\/old-name\.ts/);
  assert.match(html, /src\/new-name\.ts/);
  assert.match(html, /\+2/);
  assert.match(html, /-1/);
  assert.match(html, /old/);
  assert.match(html, /another/);
});
