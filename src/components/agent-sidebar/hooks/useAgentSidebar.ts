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
 * Owns whether the Agent sidebar is open. The sidebar is the production
 * right-hand surface, so this is the only right-rail state left: a single
 * persisted `{ open }` record under the `agent-sidebar` key. A record from
 * the earlier resizable rail still carrying a `width` is read for its `open`
 * alone and rewritten without the stale field.
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
