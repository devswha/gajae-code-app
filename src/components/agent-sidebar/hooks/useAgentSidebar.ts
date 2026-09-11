import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

import {
  AGENT_SIDEBAR_KEYBOARD_RESIZE_STEP,
  DEFAULT_AGENT_SIDEBAR_STATE,
  clampAgentSidebarWidth,
  readAgentSidebarState,
  writeAgentSidebarState,
  type AgentSidebarState,
} from '../agentSidebarState';

type UseAgentSidebarOptions = {
  isMobile: boolean;
};

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Safari throws on localStorage access with cookies blocked.
    return null;
  }
}

/**
 * Owns the presentation-only Agent sidebar shell that will replace the
 * Workspace panel: whether it is open and how wide it is.
 *
 * State is deliberately only `{ open, width }` — there is intentionally no tab
 * state and no migration of the legacy panel's persisted state; that belongs to
 * the cutover PR.
 */
export function useAgentSidebar({ isMobile }: UseAgentSidebarOptions) {
  const [state, setState] = useState<AgentSidebarState>(() => readAgentSidebarState(browserStorage()));
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const attachContainer = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    setContainerElement(element);
  }, []);

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

  const applyWidth = useCallback((width: number) => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width;
    setState((previous) => ({ ...previous, width: clampAgentSidebarWidth(width, containerWidth) }));
  }, []);

  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (isMobile) {
      return;
    }
    event.preventDefault();
    setIsResizing(true);
  }, [isMobile]);

  // Saved widths must also fit a smaller window or the space left by the sidebar.
  useEffect(() => {
    const container = containerElement;
    if (!container || isMobile || !state.open) return undefined;
    const syncWidth = () => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0) return;
      setState((previous) => {
        const width = clampAgentSidebarWidth(previous.width, bounds.width);
        return width === previous.width ? previous : { ...previous, width };
      });
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerElement, isMobile, state.open]);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isMobile) {
      return;
    }

    // The sidebar is docked right, so dragging the handle left widens it; the
    // arrow keys follow the same direction on screen.
    const delta = event.key === 'ArrowLeft'
      ? AGENT_SIDEBAR_KEYBOARD_RESIZE_STEP
      : event.key === 'ArrowRight' ? -AGENT_SIDEBAR_KEYBOARD_RESIZE_STEP : 0;
    if (delta === 0) {
      return;
    }

    event.preventDefault();
    applyWidth(state.width + delta);
  }, [applyWidth, isMobile, state.width]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const container = containerRef.current?.getBoundingClientRect();
      if (!container) {
        return;
      }
      applyWidth(container.right - event.clientX);
    };
    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [applyWidth, isResizing]);

  return {
    isOpen: state.open,
    width: isMobile ? DEFAULT_AGENT_SIDEBAR_STATE.width : state.width,
    containerRef: attachContainer,
    open,
    close,
    toggle,
    handleResizeStart,
    handleResizeKeyDown,
  };
}
