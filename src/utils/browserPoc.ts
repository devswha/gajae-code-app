import { safeExternalUrl } from './externalLink';

/**
 * Built-in WebView browser proof of concept (see docs/BUILTIN-WEBVIEW-POC.md).
 *
 * The desktop shell exposes two PoC-only Tauri commands to the served SPA on
 * its loopback origin (capability `browser-poc`). They open/focus a dedicated
 * unprivileged browser window and run a read-only `document.title` probe.
 * In a plain browser tab no bridge exists and the PoC entry point hides.
 */
export const BROWSER_POC_TEST_URL = 'https://example.com';

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

type TauriBridgeWindow = Window & {
  __TAURI__?: { core?: { invoke?: TauriInvoke } };
  __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
};

function invokeBridge(): TauriInvoke | null {
  if (typeof window === 'undefined') return null;
  const scope = window as TauriBridgeWindow;
  const invoke = scope.__TAURI__?.core?.invoke ?? scope.__TAURI_INTERNALS__?.invoke;
  return typeof invoke === 'function' ? invoke : null;
}

export const isBrowserPocAvailable = (): boolean => invokeBridge() !== null;

export type BrowserPocResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string };

export async function openBrowserPocWindow(url: string = BROWSER_POC_TEST_URL): Promise<BrowserPocResult> {
  const invoke = invokeBridge();
  if (!invoke) return { ok: false, error: 'The desktop command bridge is unavailable.' };
  const safeUrl = safeExternalUrl(url);
  if (!safeUrl) return { ok: false, error: 'The PoC browser only opens https URLs.' };
  try {
    const outcome = await invoke('browser_poc_open', { url: safeUrl }) as { created?: unknown };
    return { ok: true, created: outcome?.created === true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export async function runBrowserPocTitleProbe(): Promise<BrowserPocResult> {
  const invoke = invokeBridge();
  if (!invoke) return { ok: false, error: 'The desktop command bridge is unavailable.' };
  try {
    await invoke('browser_poc_title_probe');
    return { ok: true, created: false };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
