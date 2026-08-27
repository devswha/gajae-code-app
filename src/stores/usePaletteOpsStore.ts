import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * App-wide imperative UI operations, registered at runtime by the components
 * that own them and callable from anywhere (command palette, chat composer,
 * markdown links, editor, sidebar).
 *
 * This replaces the old PaletteOpsContext: the context existed only because
 * there was no global store to hold the registry. The store version needs no
 * provider, and the exposed `ops` wrappers are module-level constants, so
 * every consumer gets permanently stable identities.
 */
export type PaletteOps = {
  openCommandPalette: () => void;
  // Opens the command palette directly on its sessions page (used by the chat
  // composer's /resume and /sessions app commands).
  openSessionPicker: () => void;
  // Starts a new chat session in the currently selected project.
  startNewChat: () => void;
  openFile: (path: string) => void;
  // Opens a file in the editor side panel without changing the active tab
  // (used by in-chat file links so they behave like the inline edit view).
  openFileInEditor: (path: string) => void;
  // Opens an HTTP(S) link in the session-owned Browser panel.
  openBrowser: (url: string) => void;
  openSettings: (tab?: string) => void;
  refreshProjects: () => Promise<void> | void;
};

type PaletteOpsRegistry = Partial<PaletteOps>;

const usePaletteOpsRegistryStore = create<{ registry: PaletteOpsRegistry }>(() => ({
  registry: {},
}));

const OPS_KEYS = [
  'openCommandPalette',
  'openSessionPicker',
  'startNewChat',
  'openFile',
  'openFileInEditor',
  'openBrowser',
  'openSettings',
  'refreshProjects',
] as const;

/**
 * Registers the provided ops and returns an unregister function that restores
 * the previous entry — but only when the registry still points at this
 * registration (a later registration wins, exactly like the old context).
 */
function takeEntry<K extends keyof PaletteOps>(
  registry: PaletteOpsRegistry,
  previous: PaletteOpsRegistry,
  key: K,
  value: PaletteOps[K],
) {
  previous[key] = registry[key];
  registry[key] = value;
}

function restoreEntry<K extends keyof PaletteOps>(
  registry: PaletteOpsRegistry,
  previous: PaletteOpsRegistry,
  key: K,
  value: PaletteOps[K],
) {
  if (registry[key] !== value) {
    return;
  }
  const prior = previous[key];
  if (prior === undefined) {
    delete registry[key];
  } else {
    registry[key] = prior;
  }
}

export function registerPaletteOps(partial: PaletteOpsRegistry): () => void {
  const previous: PaletteOpsRegistry = {};
  usePaletteOpsRegistryStore.setState((state) => {
    const registry = { ...state.registry };
    for (const key of OPS_KEYS) {
      const value = partial[key];
      if (value) {
        takeEntry(registry, previous, key, value);
      }
    }
    return { registry };
  });

  return () => {
    usePaletteOpsRegistryStore.setState((state) => {
      const registry = { ...state.registry };
      for (const key of OPS_KEYS) {
        const value = partial[key];
        if (value) {
          restoreEntry(registry, previous, key, value);
        }
      }
      return { registry };
    });
  };
}

/** Effect wrapper preserving the old usePaletteOpsRegister call shape. */
export function usePaletteOpsRegister(partial: PaletteOpsRegistry) {
  const {
    openCommandPalette,
    openSessionPicker,
    startNewChat,
    openFile,
    openFileInEditor,
    openBrowser,
    openSettings,
    refreshProjects,
  } = partial;

  useEffect(() => {
    return registerPaletteOps({
      ...(openCommandPalette ? { openCommandPalette } : {}),
      ...(openSessionPicker ? { openSessionPicker } : {}),
      ...(startNewChat ? { startNewChat } : {}),
      ...(openFile ? { openFile } : {}),
      ...(openFileInEditor ? { openFileInEditor } : {}),
      ...(openBrowser ? { openBrowser } : {}),
      ...(openSettings ? { openSettings } : {}),
      ...(refreshProjects ? { refreshProjects } : {}),
    });
  }, [openCommandPalette, openSessionPicker, startNewChat, openFile, openFileInEditor, openBrowser, openSettings, refreshProjects]);
}

const read = () => usePaletteOpsRegistryStore.getState().registry;

/**
 * Stable call-through wrappers. Reading the registry at call time means a
 * consumer captured before registration still reaches the op afterwards, and
 * an unmounted owner degrades to a no-op — the old context's semantics.
 */
const ops: PaletteOps = {
  openCommandPalette: () => (read().openCommandPalette ?? (() => undefined))(),
  openSessionPicker: () => (read().openSessionPicker ?? (() => undefined))(),
  startNewChat: () => (read().startNewChat ?? (() => undefined))(),
  openFile: (path) => (read().openFile ?? (() => undefined))(path),
  openFileInEditor: (path) => (read().openFileInEditor ?? (() => undefined))(path),
  openBrowser: (url) => (read().openBrowser ?? (() => undefined))(url),
  openSettings: (tab) => (read().openSettings ?? (() => undefined))(tab),
  refreshProjects: () => (read().refreshProjects ?? (() => undefined))(),
};

/** Kept as a hook-shaped export so consumers only change their import path. */
export function usePaletteOps(): PaletteOps {
  return ops;
}

/** Test hygiene: the registry is module-global. */
export function resetPaletteOps() {
  usePaletteOpsRegistryStore.setState({ registry: {} });
}
