import { isBuiltinBrowserState, type BuiltinBrowserState } from '../../shared/builtinBrowserProtocol';

import { authenticatedFetch } from './api';

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type TauriWindow = Window & { __TAURI__?: { core?: { invoke?: TauriInvoke } }; __TAURI_INTERNALS__?: { invoke?: TauriInvoke } };

export type { BuiltinBrowserState };
export type BuiltinBrowserFailure = 'busy' | 'failed' | 'invalidUrl' | 'stale' | 'unavailable';

export function hasBuiltinBrowserBridge(): boolean {
  if (typeof window === 'undefined') return false;
  const scope = window as TauriWindow;
  return typeof (scope.__TAURI__?.core?.invoke ?? scope.__TAURI_INTERNALS__?.invoke) === 'function';
}

export function builtinBrowserFailure(error: unknown): BuiltinBrowserFailure {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/(?:browser_busy|browser_in_use|builtin_browser_in_use)/iu.test(message)) return 'busy';
  if (/(?:invalid_url|builtin_browser_invalid_url)/iu.test(message)) return 'invalidUrl';
  if (/(?:stale|document_changed|binding_changed)/iu.test(message)) return 'stale';
  if (/(?:builtin_browser_unavailable|unavailable|not available|unsupported)/iu.test(message)) return 'unavailable';
  return 'failed';
}

export async function openBuiltinBrowser(sessionId: string, url?: string): Promise<BuiltinBrowserState> {
  if (!hasBuiltinBrowserBridge()) throw new Error('Built-in browser automation is available only in the macOS desktop app.');
  const response = await authenticatedFetch(`/api/browser/${encodeURIComponent(sessionId)}/open`, {
    method: 'POST', body: JSON.stringify(url ? { url } : {}),
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body && typeof body === 'object' && !Array.isArray(body) && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `Could not open the built-in browser (${response.status}).`;
    throw new Error(error);
  }
  if (!isBuiltinBrowserState(body, sessionId)) throw new Error('builtin_browser_invalid_response');
  return body;
}
