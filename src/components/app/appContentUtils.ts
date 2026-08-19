/**
 * Height of the on-screen keyboard covered by the browser, for the
 * --keyboard-height variable that shrinks the app shell.
 *
 * `layoutHeight` is the layout viewport (documentElement.clientHeight) and
 * `visualHeight` the visual viewport. Only a real keyboard hides more than
 * ~150px: collapsible browser chrome (URL/tab bars) stays below that, and
 * Chrome for Android resizes the layout viewport with the keyboard
 * (interactive-widget=resizes-content), so the gap stays near zero there.
 * Chrome-sized gaps are left to the shell's dynamic-viewport height, which
 * already tracks them; treating them as a keyboard would subtract them
 * twice and float the composer above the browser chrome.
 */
export const hiddenKeyboardHeight = (layoutHeight: number, visualHeight: number): number => {
  const hidden = Math.max(0, layoutHeight - visualHeight);
  return hidden > 150 ? hidden : 0;
};
export const parseStartedAt = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
