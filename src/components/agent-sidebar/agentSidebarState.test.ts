import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_SIDEBAR_STORAGE_KEY,
  DEFAULT_AGENT_SIDEBAR_STATE,
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

test('the sidebar starts closed, and that is the whole default state', () => {
  assert.deepEqual(DEFAULT_AGENT_SIDEBAR_STATE, { open: false });
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

test('a record from the resizable rail keeps its open state and loses nothing else', () => {
  assert.deepEqual(
    readAgentSidebarState(createStorage({ [AGENT_SIDEBAR_STORAGE_KEY]: JSON.stringify({ open: true, width: 420 }) })),
    { open: true },
  );
  assert.deepEqual(
    readAgentSidebarState(createStorage({ [AGENT_SIDEBAR_STORAGE_KEY]: JSON.stringify({ open: false, width: 10_000 }) })),
    { open: false },
  );
});

test('a written state reads back unchanged', () => {
  const storage = createStorage();

  writeAgentSidebarState(storage, { open: true });

  assert.deepEqual(readAgentSidebarState(storage), { open: true });
});

test('writing persists the open flag alone, dropping a stale width from an older record', () => {
  const storage = createStorage({ [AGENT_SIDEBAR_STORAGE_KEY]: JSON.stringify({ open: true, width: 640 }) });

  writeAgentSidebarState(storage, { open: true });

  const persisted = JSON.parse(storage.entries.get(AGENT_SIDEBAR_STORAGE_KEY) ?? '{}');
  assert.deepEqual(persisted, { open: true });
  assert.deepEqual(Object.keys(persisted).sort(), ['open']);
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
