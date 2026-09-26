export const isApplePlatform = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

/**
 * A Cmd/Ctrl chord as the keyboard in front of the user labels it: `⌘⇧D` on a
 * Mac, `Ctrl+Shift+D` elsewhere. `key` is the printed key cap.
 */
export const modShortcutLabel = (key: string, { shift = false } = {}): string =>
  isApplePlatform()
    ? `⌘${shift ? '⇧' : ''}${key}`
    : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
