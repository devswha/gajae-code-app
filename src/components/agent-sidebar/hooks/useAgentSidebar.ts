import { useCallback, useEffect, useState } from 'react';

import {
  readAgentSidebarState,
  writeAgentSidebarState,
  type AgentSidebarState,
} from '../agentSidebarState';

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Safari throws on localStorage access with cookies blocked.
    return null;
  }
}

/**
 * Owns whether the experimental Agent sidebar is open.
 *
 * The persisted record is still `{ open, width }`: the desktop surface is a
 * fixed-width context panel and no longer resizes, but the stored width is
 * left as it is rather than migrated here — that belongs to the cutover PR
 * along with the legacy `workspace-panel` state. There is intentionally no tab
 * state.
 */
export function useAgentSidebar() {
  const [state, setState] = useState<AgentSidebarState>(() => readAgentSidebarState(browserStorage()));

  useEffect(() => {
    writeAgentSidebarState(browserStorage(), state);
  }, [state]);

  const open = useCallback(() => {
    setState((previous) => (previous.open ? previous : { ...previous, open: true }));
  }, []);

  const close = useCallback(() => {
    setState((previous) => (previous.open ? { ...previous, open: false } : previous));
  }, []);

  const toggle = useCallback(() => {
    setState((previous) => ({ ...previous, open: !previous.open }));
  }, []);

  return {
    isOpen: state.open,
    open,
    close,
    toggle,
  };
}
