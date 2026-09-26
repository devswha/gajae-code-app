import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

export type AnchoredPopupPosition = { top?: number; bottom?: number; left: number; maxHeight?: number };

type AnchoredPopupOptions = {
  open: boolean;
  /** `escape` restores focus to the trigger; `outside` leaves focus where the click put it. */
  onClose: (reason: 'outside' | 'escape') => void;
  /** The trigger's wrapper. Clicks inside it are not "outside". */
  anchorRef: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLElement | null>;
  width: number;
  /**
   * The popup's tallest size. With it, the popup opens below the anchor when
   * there is less room than that above it (a composer in the middle of the
   * empty-state screen); without it, it always opens above, bounded by the
   * room above.
   */
  flipBelowUnder?: number;
};

const EDGE = 8;
const GAP = 8;
const OPTION_SELECTOR = '[role="option"]:not([disabled]):not([aria-disabled="true"]), [role="menuitem"]:not([disabled]):not([aria-disabled="true"])';

function positionFor(anchor: DOMRect, width: number, flipBelowUnder: number | undefined): AnchoredPopupPosition {
  const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - width - EDGE));
  if (flipBelowUnder !== undefined && anchor.top < flipBelowUnder + GAP * 2) {
    return { top: anchor.bottom + GAP, left, maxHeight: Math.max(0, window.innerHeight - anchor.bottom - GAP * 2) };
  }
  return { bottom: window.innerHeight - anchor.top + GAP, left, maxHeight: Math.max(0, anchor.top - GAP * 2) };
}

function focusTrigger(anchor: HTMLElement | null) {
  if (!anchor) return;
  const target = anchor.matches('button, [tabindex]') ? anchor : anchor.querySelector<HTMLElement>('button:not([disabled]), [tabindex]');
  target?.focus();
}

/**
 * The one implementation of a composer popup's behaviour: it escapes the
 * composer's clipping through a body portal, sits above (or below) its
 * trigger clamped to the viewport, follows window resizes, closes on an
 * outside press or Escape - handing focus back to the trigger - and moves
 * between its options with the arrow keys. Every picker used to carry its
 * own copy of this, and the copies had drifted: one ignored Escape, none
 * could be driven from the keyboard.
 */
export function useAnchoredPopup({ open, onClose, anchorRef, popupRef, width, flipBelowUnder }: AnchoredPopupOptions): AnchoredPopupPosition {
  const [position, setPosition] = useState<AnchoredPopupPosition>({ bottom: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) setPosition(positionFor(rect, width, flipBelowUnder));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open, anchorRef, width, flipBelowUnder]);

  useEffect(() => {
    if (!open) return undefined;
    const pressOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !popupRef.current?.contains(target)) onClose('outside');
    };
    const keydown = (event: KeyboardEvent) => {
      // A handled Escape (a search field clearing itself, or the run's
      // capture-phase Stop, which owns Escape while a run can be stopped)
      // leaves the popup alone.
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose('escape');
        focusTrigger(anchorRef.current);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const popup = popupRef.current;
      const active = document.activeElement;
      if (!popup || !(popup.contains(active) || anchorRef.current?.contains(active))) return;
      const options = Array.from(popup.querySelectorAll<HTMLElement>(OPTION_SELECTOR));
      if (options.length === 0) return;
      event.preventDefault();
      const current = options.indexOf(active as HTMLElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = current === -1
        ? (step === 1 ? 0 : options.length - 1)
        : (current + step + options.length) % options.length;
      options[next]?.focus();
    };
    document.addEventListener('mousedown', pressOutside);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('mousedown', pressOutside);
      document.removeEventListener('keydown', keydown);
    };
  }, [open, onClose, anchorRef, popupRef]);

  return position;
}
