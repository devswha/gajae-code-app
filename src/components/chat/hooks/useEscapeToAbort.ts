import { useEffect } from 'react';

/**
 * Escape stops the run, from anywhere in the document, while one can be
 * stopped. The listener captures so a focused textarea or an open menu cannot
 * swallow the key first; a repeat or an already-handled Escape is ignored.
 * This is the keyboard twin of the composer's Stop button.
 */
export function useEscapeToAbort(canAbort: boolean, onAbort: () => void): void {
  useEffect(() => {
    if (!canAbort) return undefined;
    const interceptEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return;
      event.preventDefault();
      onAbort();
    };
    document.addEventListener('keydown', interceptEscape, { capture: true });
    return () => document.removeEventListener('keydown', interceptEscape, { capture: true });
  }, [canAbort, onAbort]);
}
