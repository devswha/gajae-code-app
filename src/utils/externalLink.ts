import { authenticatedFetch } from './api';

const MAX_URL_LENGTH = 4096;

let desktopShell = false;

/**
 * Recorded once from the auth bootstrap: the desktop webview loads the
 * server's loopback origin, where neither Tauri IPC nor `window.open` reach
 * the outside, so links have to go through the sidecar there.
 */
export const markDesktopShell = (value: boolean): void => {
  desktopShell = value;
};

export const isDesktopShell = (): boolean => desktopShell;

/** Only web pages leave the app: https with a host, nothing else. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Opens a web page in the person's browser. Inside the desktop shell the
 * sidecar asks the OS to open it; in a browser a new tab does. Returns false
 * only when the link could not be opened, so callers can fall back to
 * showing it.
 */
export async function openExternalUrl(value: unknown): Promise<boolean> {
  const url = safeExternalUrl(value);
  if (!url || typeof window === 'undefined') return false;

  if (desktopShell) {
    try {
      const response = await authenticatedFetch('/api/system/open-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // `noopener` makes window.open return null even when the tab opened, so the
  // return value says nothing; a blocked popup throws or returns null too, and
  // the caller keeps the visible link for that case.
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}

/**
 * Inside the desktop shell, every `<a target="_blank">` to an https page
 * routes through {@link openExternalUrl}; outside it the browser handles the
 * anchor itself. Returns the listener's disposer.
 */
export function routeExternalAnchors(root: Document): () => void {
  const onClick = (event: MouseEvent) => {
    if (!desktopShell || event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.target !== '_blank') return;
    const url = safeExternalUrl(anchor.href);
    if (!url) return;
    event.preventDefault();
    void openExternalUrl(url);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
