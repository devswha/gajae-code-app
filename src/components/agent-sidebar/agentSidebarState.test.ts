import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_SIDEBAR_STORAGE_KEY,
  DEFAULT_AGENT_SIDEBAR_STATE,
  DEFAULT_AGENT_SIDEBAR_WIDTH,
  MIN_AGENT_SIDEBAR_WIDTH,
  clampAgentSidebarWidth,
  readAgentSidebarState,
  writeAgentSidebarState,
  type AgentSidebarStorage,
} from './agentSidebarState';

function createStorage(seed: Record<string, string> = {}): AgentSidebarStorage & { entries: Map<string, string> } {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

test('the sidebar starts closed at the default width', () => {
  assert.deepEqual(DEFAULT_AGENT_SIDEBAR_STATE, { open: false, width: 384 });
});

test('no storage at all yields the closed default instead of throwing', () => {
  assert.deepEqual(readAgentSidebarState(null), DEFAULT_AGENT_SIDEBAR_STATE);
});

test('a storage that has never seen the sidebar yields the default', () => {
  assert.deepEqual(readAgentSidebarState(createStorage()), DEFAULT_AGENT_SIDEBAR_STATE);
});

test('a corrupt or foreign payload degrades to the default instead of rendering garbage', () => {
  assert.deepEqual(readAgentSidebarState(createStorage({ [AGENT_SIDEBAR_STORAGE_KEY]: 'not json' })), DEFAULT_AGENT_SIDEBAR_STATE);
  assert.deepEqual(readAgentSidebarState(createStorage({ [AGENT_SIDEBAR_STORAGE_KEY]: '"a string"' })), DEFAULT_AGENT_SIDEBAR_STATE);
  assert.deepEqual(readAgentSidebarState(createStorage({ [AGENT_SIDEBAR_STORAGE_KEY]: '[1,2,3]' })), DEFAULT_AGENT_SIDEBAR_STATE);
  assert.deepEqual(
    readAgentSidebarState(createStorage({ [AGENT_SIDEBAR_STORAGE_KEY]: JSON.stringify({ open: 'yes', width: 'wide' }) })),
    DEFAULT_AGENT_SIDEBAR_STATE,
  );
});

test('a non-numeric width falls back to the default without closing an open sidebar', () => {
  assert.deepEqual(
    readAgentSidebarState(createStorage({ [AGENT_SIDEBAR_STORAGE_KEY]: JSON.stringify({ open: true, width: null }) })),
    { open: true, width: DEFAULT_AGENT_SIDEBAR_WIDTH },
  );
});

test('a persisted state is restored with its width clamped', () => {
  assert.deepEqual(
    readAgentSidebarState(createStorage({ [AGENT_SIDEBAR_STORAGE_KEY]: JSON.stringify({ open: true, width: 12 }) })),
    { open: true, width: MIN_AGENT_SIDEBAR_WIDTH },
  );
  assert.deepEqual(
    readAgentSidebarState(createStorage({ [AGENT_SIDEBAR_STORAGE_KEY]: JSON.stringify({ open: true, width: 10_000 }) })),
    { open: true, width: 1600 },
  );
});

test('a written state reads back unchanged', () => {
  const storage = createStorage();

  writeAgentSidebarState(storage, { open: true, width: 420 });

  assert.deepEqual(readAgentSidebarState(storage), { open: true, width: 420 });
});

test('writing persists the clamped width and nothing but open and width', () => {
  const storage = createStorage();

  writeAgentSidebarState(storage, { open: true, width: 10_000 });

  const persisted = JSON.parse(storage.entries.get(AGENT_SIDEBAR_STORAGE_KEY) ?? '{}');
  assert.deepEqual(persisted, { open: true, width: 1600 });
  assert.deepEqual(Object.keys(persisted).sort(), ['open', 'width']);
});

test('a width narrower than the minimum is raised instead of collapsing the sidebar', () => {
  assert.equal(clampAgentSidebarWidth(40), MIN_AGENT_SIDEBAR_WIDTH);
});

test('a container width caps the sidebar so the chat keeps a fifth of the row', () => {
  assert.equal(clampAgentSidebarWidth(5000, 1000), 800);
});

test('a container too narrow to honor the ratio still yields the minimum width', () => {
  assert.equal(clampAgentSidebarWidth(500, 200), MIN_AGENT_SIDEBAR_WIDTH);
});

test('a narrow desktop row preserves the chat minimum instead of clipping the right edge', () => {
  assert.equal(clampAgentSidebarWidth(900, 768), 568);
  assert.equal(clampAgentSidebarWidth(900, 488), 288);
});

test('a non-finite width falls back to the default rather than styling NaN', () => {
  assert.equal(clampAgentSidebarWidth(Number.NaN), DEFAULT_AGENT_SIDEBAR_WIDTH);
});

test('the legacy workspace panel state is deliberately not migrated', () => {
  const storage = createStorage({
    'workspace-panel': JSON.stringify({ open: true, tab: 'browser', width: 900 }),
  });

  assert.deepEqual(readAgentSidebarState(storage), DEFAULT_AGENT_SIDEBAR_STATE);
});

test('a storage that throws never propagates out of read or write', () => {
  const hostile: AgentSidebarStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };

  assert.deepEqual(readAgentSidebarState(hostile), DEFAULT_AGENT_SIDEBAR_STATE);
  assert.doesNotThrow(() => writeAgentSidebarState(hostile, DEFAULT_AGENT_SIDEBAR_STATE));
});
