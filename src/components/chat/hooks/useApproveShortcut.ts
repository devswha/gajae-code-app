import { useEffect, useRef } from 'react';

import { modShortcutLabel } from '../../../utils/shortcutLabel';

type Chord = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat' | 'isComposing'>;

/** Cmd/Ctrl+Enter, the approve chord of a pending permission or plan card. */
export const isApproveChord = (event: Chord): boolean =>
  (event.metaKey || event.ctrlKey) && event.key === 'Enter'
  && !event.shiftKey && !event.altKey && !event.repeat && !event.isComposing;

export const approveShortcutLabel = (): string => modShortcutLabel('↩');

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Approves the waiting card from the keyboard. A text field keeps the chord:
 * in the composer Cmd/Ctrl+Enter sends the draft, and a half-typed message
 * must never turn into an approval.
 */
export function useApproveShortcut(enabled: boolean, approve: () => void): void {
  const latest = useRef(approve);
  useEffect(() => {
    latest.current = approve;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isApproveChord(event)) return;
      if (event.target instanceof Element && event.target.closest(EDITABLE)) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [enabled]);
}
