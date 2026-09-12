import { isBrowserSessionState, type BrowserSessionState } from './browserSessionState.js';

/** Native identity captured before an origin permission prompt or a browser action. */
export type BuiltinBrowserBinding = { windowEpoch: string; documentEpoch: number; origin: string | null };
export type BuiltinBrowserState = BrowserSessionState & {
  binding: BuiltinBrowserBinding | null;
  profileMode: 'persistent' | 'ephemeral';
};

export type BuiltinBrowserCommand =
  | { action: 'navigate'; url: string }
  | { action: 'back' | 'forward' | 'reload' | 'observe' }
  | { action: 'extract'; selector?: string; format?: 'text' | 'html' }
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; text: string };

export function isBuiltinBrowserBinding(value: unknown): value is BuiltinBrowserBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return Object.keys(binding).length === 3
    && typeof binding.windowEpoch === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(binding.windowEpoch)
    && Number.isSafeInteger(binding.documentEpoch) && (binding.documentEpoch as number) >= 0
    && (binding.origin === null || (typeof binding.origin === 'string' && binding.origin.length <= 4096
      && /^https?:\/\//u.test(binding.origin)));
}

export function isBuiltinBrowserState(value: unknown, sessionId: string): value is BuiltinBrowserState {
  if (!isBrowserSessionState(value, sessionId)) return false;
  const state = value as BuiltinBrowserState;
  return (state.profileMode === 'persistent' || state.profileMode === 'ephemeral')
    && ((state.tabs.length === 0 && state.binding === null && state.activeTabId === null)
      || (state.tabs.length === 1 && state.activeTabId === state.tabs[0].id && isBuiltinBrowserBinding(state.binding)));
}
