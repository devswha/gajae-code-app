import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSessionStore } from '../../../stores/useSessionStore';
import type { ProjectChange } from '../hooks/useProjectChanges';

import WorkspaceChangesTab, { ChangeRow, LineCommentBox, type WorkspaceChangesTabProps } from './WorkspaceChangesTab';

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
  patchOmitted: false,
};

function WorkspaceChangesHarness({ overrides }: { overrides: Partial<WorkspaceChangesTabProps> }) {
  const sessionStore = useSessionStore();
  return createElement(WorkspaceChangesTab, {
    projectId: 'project-alpha',
    projectPath: '/work/alpha',
    projectName: 'Alpha Workspace',
    active: true,
    ...overrides,
    sessionStore: overrides.sessionStore ?? sessionStore,
  });
}

function render(overrides: Partial<WorkspaceChangesTabProps> = {}): string {
  const client = new QueryClient();
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(WorkspaceChangesHarness, { overrides }),
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
    openPath: changedFile.path,
    onSetOpenPath: () => {},
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

test('a row with an insert target offers a line comment and sends the formatted draft', () => {
  const html = renderToStaticMarkup(createElement(ChangeRow, {
    file: changedFile,
    openPath: changedFile.path,
    onSetOpenPath: () => {},
    onOpenInEditor: () => {},
    onComposerInsert: () => true,
    t,
  }));
  assert.match(html, /aria-label="workspace\.changes\.comment\.add"/);

  // Without an insert target the offer is absent.
  const bare = renderToStaticMarkup(createElement(ChangeRow, {
    file: changedFile, openPath: changedFile.path, onSetOpenPath: () => {}, onOpenInEditor: () => {}, t,
  }));
  assert.doesNotMatch(bare, /comment\.add/);
});

test('a missing preview is not mislabeled as an oversized diff', () => {
  const html = renderToStaticMarkup(createElement(ChangeRow, {
    file: { ...changedFile, patch: null, tooLarge: false, patchOmitted: true },
    openPath: changedFile.path,
    onSetOpenPath: () => {},
    onOpenInEditor: () => {},
    t,
  }));

  assert.match(html, /workspace\.changes\.unavailable/);
  assert.doesNotMatch(html, /workspace\.changes\.tooLarge/);
});

test('the comment box shows its reference and placeholder, disabled until typed', () => {
  const html = renderToStaticMarkup(createElement(LineCommentBox, {
    path: 'src/foo.ts',
    row: { rowIndex: 0, oldLine: null, newLine: 42, kind: 'added', content: 'const x = 1;' },
    onSubmit: () => {},
    onCancel: () => {},
    t,
  }));
  assert.match(html, /data-line-comment="src\/foo\.ts:42"/);
  assert.match(html, /placeholder="workspace\.changes\.comment\.placeholder"/);
  assert.match(html, /disabled/);
  assert.match(html, /aria-label="workspace\.changes\.comment\.send"/);
});

test('the comment box displays the current-file line for shifted context', () => {
  const html = renderToStaticMarkup(createElement(LineCommentBox, {
    path: 'src/foo.ts',
    row: { rowIndex: 2, oldLine: 7, newLine: 9, kind: 'context', content: 'keep();' },
    onSubmit: () => {},
    onCancel: () => {},
    t,
  }));
  assert.match(html, /data-line-comment="src\/foo\.ts:9"/);
});
