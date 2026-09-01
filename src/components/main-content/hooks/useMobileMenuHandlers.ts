import { useCallback, useRef } from 'react';
import type { MouseEvent, TouchEvent } from 'react';

type MenuEvent = MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>;

function stopMenuEvent(event: MenuEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function useMobileMenuHandlers(onMenuClick: () => void) {
  const ignoreClick = useRef(false);

  const triggerMenu = useCallback((event: MenuEvent) => {
    stopMenuEvent(event);
    onMenuClick();
  }, [onMenuClick]);

  const handleMobileMenuTouchEnd = useCallback((event: TouchEvent<HTMLButtonElement>) => {
    ignoreClick.current = true;
    triggerMenu(event);
    window.setTimeout(() => {
      ignoreClick.current = false;
    }, 350);
  }, [triggerMenu]);

  const handleMobileMenuClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (ignoreClick.current) {
      stopMenuEvent(event);
      return;
    }

    triggerMenu(event);
  }, [triggerMenu]);

  return { handleMobileMenuClick, handleMobileMenuTouchEnd };
}
