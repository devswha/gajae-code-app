import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WORKSPACE_PANEL_WIDTH,
  WORKSPACE_PANEL_STORAGE_KEY,
  clampWorkspacePanelWidth,
  normalizeWorkspaceTab,
  readWorkspacePanelState,
  workspaceTabForKey,
} from './workspacePanelState.js';

function storage(values: Record<string, string> = {}) {
  const items = new Map(Object.entries(values));
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value), removeItem: (key: string) => items.delete(key) };
}

test('workspace panel preserves sizing bounds and Status/Changes keyboard navigation', () => {
  assert.equal(clampWorkspacePanelWidth(Number.NaN), DEFAULT_WORKSPACE_PANEL_WIDTH);
  assert.equal(clampWorkspacePanelWidth(20), 280);
  assert.equal(clampWorkspacePanelWidth(2000), 1600);
  assert.equal(clampWorkspacePanelWidth(900, 800), 600);
  assert.equal(workspaceTabForKey('status', 'ArrowLeft'), 'changes');
  assert.equal(workspaceTabForKey('changes', 'ArrowRight'), 'status');
  assert.equal(workspaceTabForKey('changes', 'Home'), 'status');
  assert.equal(workspaceTabForKey('status', 'End'), 'changes');
});

test('saved Browser rails close during migration while valid rails retain stored state', () => {
  const old = storage({ [WORKSPACE_PANEL_STORAGE_KEY]: JSON.stringify({ open: true, tab: 'browser', width: 500 }) });
  assert.deepEqual(readWorkspacePanelState(old), { open: false, tab: 'status', width: 500 });
  const current = storage({ [WORKSPACE_PANEL_STORAGE_KEY]: JSON.stringify({ open: true, tab: 'changes', width: 500 }) });
  assert.deepEqual(readWorkspacePanelState(current), { open: true, tab: 'changes', width: 500 });
  assert.equal(normalizeWorkspaceTab('browser'), 'status');
});
