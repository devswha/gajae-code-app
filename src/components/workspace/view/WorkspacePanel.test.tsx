import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CodeEditorFile } from '../../code-editor/types/types';
import { MIN_WORKSPACE_PANEL_WIDTH } from '../workspacePanelState';

import WorkspacePanel, { type WorkspacePanelProps } from './WorkspacePanel';

const editingFile: CodeEditorFile = {
  name: 'server.ts',
  path: '/work/alpha/server.ts',
  projectId: 'project-alpha',
  diffInfo: null,
};

function render(overrides: Partial<WorkspacePanelProps> = {}): string {
  const props: WorkspacePanelProps = {
    tab: 'files',
    width: 420,
    expanded: false,
    isMobile: false,
    editingFile: null,
    projectPath: '/work/alpha',
    automationSessionId: 'session-alpha',
    resizeHandleRef: { current: null },
    onTabChange: () => undefined,
    onResizeStart: () => undefined,
    onResizeKeyDown: () => undefined,
    onToggleExpand: () => undefined,
    onClose: () => undefined,
    onFileOpen: () => undefined,
    onCloseEditor: () => undefined,
    ...overrides,
  };

  return renderToStaticMarkup(createElement(WorkspacePanel, props));
}

test('the tab strip is a tablist whose selected tab owns the rendered panel', () => {
  const html = render({ tab: 'editor' });

  assert.match(html, /role="tablist"/);
  assert.match(html, /id="workspace-tab-status"[^>]*role="tab"[^>]*aria-selected="false"/);
  assert.match(html, /id="workspace-tab-files"[^>]*role="tab"[^>]*aria-selected="false"/);
  assert.match(html, /id="workspace-tab-editor"[^>]*role="tab"[^>]*aria-selected="true"/);
  assert.match(html, /id="workspace-tab-browser"[^>]*role="tab"[^>]*aria-selected="false"/);
  assert.match(html, /role="tabpanel" id="workspace-tabpanel-editor" aria-labelledby="workspace-tab-editor"/);
});

test('the status tab owns its own panel region', () => {
  const html = render({ tab: 'status' });

  assert.match(html, /id="workspace-tab-status"[^>]*aria-selected="true"/);
  assert.match(html, /role="tabpanel" id="workspace-tabpanel-status" aria-labelledby="workspace-tab-status"/);
});

test('only the selected tab is reachable with Tab, the rest with arrow keys', () => {
  const html = render({ tab: 'files' });

  assert.match(html, /id="workspace-tab-files"[^>]*tabindex="0"/);
  assert.match(html, /id="workspace-tab-status"[^>]*tabindex="-1"/);
  assert.match(html, /id="workspace-tab-editor"[^>]*tabindex="-1"/);
  assert.match(html, /id="workspace-tab-browser"[^>]*tabindex="-1"/);
});

test('the resize handle is a focusable separator carrying the current width', () => {
  const html = render({ width: 420 });

  assert.match(html, /role="separator"/);
  assert.match(html, /aria-orientation="vertical"/);
  assert.match(html, /aria-valuenow="420"/);
  assert.match(html, new RegExp(`aria-valuemin="${MIN_WORKSPACE_PANEL_WIDTH}"`));
  assert.match(html, /role="separator"[^>]*tabindex="0"/);
  assert.match(html, /style="width:420px/);
});

test('an expanded panel drops the separator because there is nothing left to resize', () => {
  const html = render({ expanded: true });

  assert.doesNotMatch(html, /role="separator"/);
  assert.doesNotMatch(html, /style="width:/);
});

test('the mobile panel is an overlay with a dismiss backdrop and no resizing', () => {
  const html = render({ isMobile: true });

  // Above the chat, below the mobile sidebar, so navigation always wins.
  assert.match(html, /class="fixed inset-0 z-30 bg-background\/80 backdrop-blur-sm"/);
  assert.match(html, /fixed inset-y-0 right-0 z-40/);
  assert.doesNotMatch(html, /role="separator"/);
  assert.doesNotMatch(html, /workspace\.expand|workspace\.collapse/);
});

test('the editor tab explains itself instead of rendering an empty frame', () => {
  const html = render({ tab: 'editor', editingFile: null });

  assert.match(html, /workspace\.editorEmpty\.title/);
  assert.match(html, /workspace\.editorEmpty\.description/);
});

test('an open file replaces the editor empty state', () => {
  const html = render({ tab: 'editor', editingFile });

  assert.doesNotMatch(html, /workspace\.editorEmpty\.title/);
});

test('the panel keeps one close control, labelled for assistive technology', () => {
  const html = render();

  const closeLabels = html.match(/aria-label="workspace\.close"/g) ?? [];
  assert.equal(closeLabels.length, 1);
});
