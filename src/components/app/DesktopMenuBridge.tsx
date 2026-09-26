import { useEffect } from 'react';

import { DISCORD_INVITE_URL, GITHUB_ISSUES_URL, GITHUB_REPOSITORY_URL } from '../../constants/branding';
import { usePaletteOps, type PaletteOps } from '../../stores/usePaletteOpsStore';
import { openExternalUrl } from '../../utils/externalLink';

/**
 * The window event the macOS shell dispatches when a menu command is chosen
 * (`src-tauri/src/app_menu.rs`). The shell has no IPC into this origin, so it
 * evaluates `window.dispatchEvent(new CustomEvent(DESKTOP_MENU_EVENT, { detail }))`
 * with one of the command ids below; anything else is ignored.
 */
export const DESKTOP_MENU_EVENT = 'gajae:menu';

export const DESKTOP_MENU_COMMANDS = {
  'new-conversation': (ops) => ops.startNewChat(),
  'new-workspace': (ops) => ops.createWorkspace(),
  settings: (ops) => ops.openSettings(),
  'command-palette': (ops) => ops.openCommandPalette(),
  'toggle-sidebar': (ops) => ops.toggleSidebar(),
  'toggle-agent-panel': (ops) => ops.toggleAgentPanel(),
  'report-issue': () => { void openExternalUrl(GITHUB_ISSUES_URL); },
  community: () => { void openExternalUrl(DISCORD_INVITE_URL); },
  repository: () => { void openExternalUrl(GITHUB_REPOSITORY_URL); },
} as const satisfies Record<string, (ops: PaletteOps) => void>;

export type DesktopMenuCommand = keyof typeof DESKTOP_MENU_COMMANDS;

const isCommand = (value: unknown): value is DesktopMenuCommand =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(DESKTOP_MENU_COMMANDS, value);

/** Runs the app command behind a native menu item. Mounted once at the root. */
export default function DesktopMenuBridge() {
  const ops = usePaletteOps();

  useEffect(() => {
    const run = (event: Event) => {
      const command = (event as CustomEvent<unknown>).detail;
      if (isCommand(command)) DESKTOP_MENU_COMMANDS[command](ops);
    };
    window.addEventListener(DESKTOP_MENU_EVENT, run);
    return () => window.removeEventListener(DESKTOP_MENU_EVENT, run);
  }, [ops]);

  return null;
}
