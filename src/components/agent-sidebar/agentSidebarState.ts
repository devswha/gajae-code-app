/**
 * Persisted state for the right-hand Agent sidebar.
 *
 * The sidebar is the one production right-hand surface, and its state is
 * deliberately just `{ open }`: the desktop lane is a fixed-width context
 * column, so there is no width to remember and no tab state either. A record
 * written by the earlier resizable rail (`{ open, width }`) is read for its
 * `open` alone, and the next write drops the stale field.
 */

export type AgentSidebarState = {
  open: boolean;
};

export type AgentSidebarStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const AGENT_SIDEBAR_STORAGE_KEY = 'agent-sidebar';

/** The conversation keeps at least this much of the row beside the lane. */
export const MIN_AGENT_SIDEBAR_CHAT_WIDTH = 200;

export const DEFAULT_AGENT_SIDEBAR_STATE: AgentSidebarState = {
  open: false,
};

export function readAgentSidebarState(storage: AgentSidebarStorage | null): AgentSidebarState {
  if (!storage) {
    return DEFAULT_AGENT_SIDEBAR_STATE;
  }

  let raw: string | null = null;
  try {
    raw = storage.getItem(AGENT_SIDEBAR_STORAGE_KEY);
  } catch {
    return DEFAULT_AGENT_SIDEBAR_STATE;
  }

  if (raw === null) {
    return DEFAULT_AGENT_SIDEBAR_STATE;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_AGENT_SIDEBAR_STATE;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_AGENT_SIDEBAR_STATE;
  }

  return {
    open: (parsed as Record<string, unknown>).open === true,
  };
}

export function writeAgentSidebarState(storage: AgentSidebarStorage | null, state: AgentSidebarState): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(AGENT_SIDEBAR_STORAGE_KEY, JSON.stringify({ open: state.open }));
  } catch {
    // A full or blocked storage must not take the sidebar down with it.
  }
}
