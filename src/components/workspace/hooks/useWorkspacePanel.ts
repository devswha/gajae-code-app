import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

import {
  DEFAULT_WORKSPACE_PANEL_STATE,
  WORKSPACE_PANEL_KEYBOARD_RESIZE_STEP,
  clampWorkspacePanelWidth,
  readWorkspacePanelState,
  writeWorkspacePanelState,
  type WorkspacePanelState,
  type WorkspaceTab,
} from '../workspacePanelState';

type UseWorkspacePanelOptions = {
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
 * Owns the right-hand Workspace panel: whether it is open, which surface it
 * shows, how wide it is, and whether it has taken over the main row.
 *
 * Width lives here rather than inside the editor because the panel — not its
 * current tab — is what the user drags; switching from Files to Editor must not
 * resize anything.
 */
export function useWorkspacePanel({ isMobile }: UseWorkspacePanelOptions) {
  const [state, setState] = useState<WorkspacePanelState>(() => readWorkspacePanelState(browserStorage()));
  const [expanded, setExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    writeWorkspacePanelState(browserStorage(), state);
  }, [state]);

  useEffect(() => {
    // An expanded panel hides the chat, so it must not survive the panel being
    // closed or the layout would come back with no chat and no panel.
    if (!state.open && expanded) {
      setExpanded(false);
    }
  }, [expanded, state.open]);

  const openPanel = useCallback((tab?: WorkspaceTab) => {
    setState((previous) => ({ ...previous, open: true, tab: tab ?? previous.tab }));
  }, []);

  const closePanel = useCallback(() => {
    setState((previous) => (previous.open ? { ...previous, open: false } : previous));
  }, []);

  const togglePanel = useCallback(() => {
    setState((previous) => ({ ...previous, open: !previous.open }));
  }, []);

  const setTab = useCallback((tab: WorkspaceTab) => {
    setState((previous) => ({ ...previous, open: true, tab }));
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((previous) => !previous);
  }, []);

  const applyWidth = useCallback((width: number) => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width;
    setState((previous) => ({ ...previous, width: clampWorkspacePanelWidth(width, containerWidth) }));
  }, []);

  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (isMobile || expanded) {
      return;
    }
    event.preventDefault();
    setIsResizing(true);
  }, [expanded, isMobile]);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isMobile || expanded) {
      return;
    }

    // The panel is docked right, so dragging the handle left widens it; the
    // arrow keys follow the same direction on screen.
    const delta = event.key === 'ArrowLeft'
      ? WORKSPACE_PANEL_KEYBOARD_RESIZE_STEP
      : event.key === 'ArrowRight' ? -WORKSPACE_PANEL_KEYBOARD_RESIZE_STEP : 0;
    if (delta === 0) {
      return;
    }

    event.preventDefault();
    applyWidth(state.width + delta);
  }, [applyWidth, expanded, isMobile, state.width]);

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
    tab: state.tab,
    width: isMobile ? DEFAULT_WORKSPACE_PANEL_STATE.width : state.width,
    expanded: expanded && !isMobile,
    isResizing,
    containerRef,
    resizeHandleRef,
    openPanel,
    closePanel,
    togglePanel,
    setTab,
    toggleExpanded,
    handleResizeStart,
    handleResizeKeyDown,
  };
}
