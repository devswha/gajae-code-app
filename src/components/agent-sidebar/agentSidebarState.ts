/**
 * Persisted state for the right-hand Agent sidebar.
 *
 * This is the presentation-only shell that will replace the Workspace panel.
 * Its state is deliberately just `{ open, width }`: there is intentionally no
 * tab state — the sidebar shows one surface — and intentionally no migration
 * from the legacy `workspace-panel` key. Carrying the old state over belongs to
 * the cutover PR that actually swaps the panel out, not to this boundary.
 */

export type AgentSidebarState = {
  open: boolean;
  width: number;
};

export type AgentSidebarStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const AGENT_SIDEBAR_STORAGE_KEY = 'agent-sidebar';

export const MIN_AGENT_SIDEBAR_WIDTH = 280;
export const MIN_AGENT_SIDEBAR_CHAT_WIDTH = 200;
export const DEFAULT_AGENT_SIDEBAR_WIDTH = 384;
export const AGENT_SIDEBAR_KEYBOARD_RESIZE_STEP = 24;

// A sidebar wider than this leaves the chat unusable, which is the one thing
// the sidebar must never do; the ratio applies whenever a container width is
// known.
const MAX_CONTAINER_RATIO = 0.8;
export const MAX_AGENT_SIDEBAR_WIDTH = 1600;

export const DEFAULT_AGENT_SIDEBAR_STATE: AgentSidebarState = {
  open: false,
  width: DEFAULT_AGENT_SIDEBAR_WIDTH,
};

export function clampAgentSidebarWidth(width: number, containerWidth?: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_AGENT_SIDEBAR_WIDTH;
  }

  const ceiling = typeof containerWidth === 'number' && containerWidth > 0
    ? Math.max(MIN_AGENT_SIDEBAR_WIDTH, Math.min(
      Math.floor(containerWidth * MAX_CONTAINER_RATIO),
      containerWidth - MIN_AGENT_SIDEBAR_CHAT_WIDTH,
    ))
    : MAX_AGENT_SIDEBAR_WIDTH;

  return Math.round(Math.min(Math.max(width, MIN_AGENT_SIDEBAR_WIDTH), ceiling));
}

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

  const record = parsed as Record<string, unknown>;
  const width = typeof record.width === 'number' && Number.isFinite(record.width)
    ? record.width
    : DEFAULT_AGENT_SIDEBAR_WIDTH;

  return {
    open: record.open === true,
    width: clampAgentSidebarWidth(width),
  };
}

export function writeAgentSidebarState(storage: AgentSidebarStorage | null, state: AgentSidebarState): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(AGENT_SIDEBAR_STORAGE_KEY, JSON.stringify({
      open: state.open,
      width: clampAgentSidebarWidth(state.width),
    }));
  } catch {
    // A full or blocked storage must not take the sidebar down with it.
  }
}
