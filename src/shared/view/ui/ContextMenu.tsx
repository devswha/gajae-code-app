import * as React from 'react';
import { createPortal } from 'react-dom';

import { MenuItems, type ActionMenuItem } from './ActionMenu';

const EDGE = 8;
const ITEM = '[role="menuitem"]:not([disabled])';

type Point = { x: number; y: number };

/**
 * A right-click menu for a row: the same items as its "…" button, opened at
 * the pointer the way a native list does. Without it, a secondary click on a
 * row that is a link showed WebKit's "Open Link in New Window" menu.
 *
 * Returns the handler for the row's `onContextMenu` and the menu to render
 * next to the row (it portals to the body).
 */
export function useContextMenu(items: readonly ActionMenuItem[], label: string) {
  const [point, setPoint] = React.useState<Point | null>(null);
  const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);
  const popup = React.useRef<HTMLDivElement | null>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);

  const close = React.useCallback((restoreFocus: boolean) => {
    setPoint(null);
    setPosition(null);
    if (restoreFocus) returnFocus.current?.focus();
    returnFocus.current = null;
  }, []);

  const onContextMenu = (event: React.MouseEvent) => {
    if (items.length === 0) return;
    event.preventDefault();
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPosition(null);
    setPoint({ x: event.clientX, y: event.clientY });
  };

  // Measure before paint, then keep the whole menu on screen: it opens
  // left/up from the pointer when there is no room right/below.
  React.useLayoutEffect(() => {
    if (!point || !popup.current) return;
    const { width, height } = popup.current.getBoundingClientRect();
    const left = point.x + width > window.innerWidth - EDGE ? Math.max(EDGE, point.x - width) : point.x;
    const top = point.y + height > window.innerHeight - EDGE ? Math.max(EDGE, point.y - height) : point.y;
    setPosition({ left, top });
  }, [point]);

  React.useEffect(() => {
    if (!point) return undefined;
    popup.current?.querySelector<HTMLElement>(ITEM)?.focus();
    const pressOutside = (event: MouseEvent) => {
      if (!popup.current?.contains(event.target as Node)) close(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const entries = Array.from(popup.current?.querySelectorAll<HTMLElement>(ITEM) ?? []);
      if (entries.length === 0) return;
      event.preventDefault();
      const current = entries.indexOf(document.activeElement as HTMLElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      entries[(current + step + entries.length) % entries.length]?.focus();
    };
    const dismiss = () => close(false);
    document.addEventListener('mousedown', pressOutside);
    document.addEventListener('keydown', keydown);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    // The row scrolls away from the menu; a native menu closes with it.
    document.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', pressOutside);
      document.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      document.removeEventListener('scroll', dismiss, true);
    };
  }, [point, close]);

  const choose = (item: ActionMenuItem) => {
    if (item.disabled || item.loading) return;
    close(false);
    item.onSelect();
  };

  const menu = point && createPortal(
    <div
      ref={popup}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-90 min-w-55 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style={position ?? { left: point.x, top: point.y, visibility: 'hidden' }}
    >
      <MenuItems items={[...items]} onChoose={choose} />
    </div>,
    document.body,
  );

  return { onContextMenu, menu, isOpen: point !== null };
}
