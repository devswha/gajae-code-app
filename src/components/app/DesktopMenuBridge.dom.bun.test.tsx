import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, render } from '@testing-library/react';

import { registerPaletteOps, resetPaletteOps } from '../../stores/usePaletteOpsStore';

import DesktopMenuBridge, { DESKTOP_MENU_EVENT } from './DesktopMenuBridge';

afterEach(() => {
  cleanup();
  resetPaletteOps();
});

const choose = (detail: unknown) => act(() => {
  window.dispatchEvent(new CustomEvent(DESKTOP_MENU_EVENT, { detail }));
});

test('each native menu command runs its app operation', () => {
  const calls: string[] = [];
  registerPaletteOps({
    startNewChat: () => calls.push('new'),
    createWorkspace: () => calls.push('workspace'),
    openSettings: () => calls.push('settings'),
    openCommandPalette: () => calls.push('palette'),
    toggleSidebar: () => calls.push('sidebar'),
    toggleAgentPanel: () => calls.push('agent'),
  });
  render(<DesktopMenuBridge />);

  for (const command of ['new-conversation', 'new-workspace', 'settings', 'command-palette', 'toggle-sidebar', 'toggle-agent-panel']) choose(command);
  assert.deepEqual(calls, ['new', 'workspace', 'settings', 'palette', 'sidebar', 'agent']);
});

test('an unknown or malformed command does nothing', () => {
  const calls: string[] = [];
  registerPaletteOps({ startNewChat: () => calls.push('new') });
  render(<DesktopMenuBridge />);

  choose('toString');
  choose({ command: 'new-conversation' });
  choose(undefined);
  assert.deepEqual(calls, []);
});
