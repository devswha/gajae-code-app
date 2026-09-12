export type { BuiltinBrowserCommand as BrowserCommand, BuiltinBrowserState as BrowserSessionState } from '../../../shared/builtinBrowserProtocol.js';

/** App-owned session scope accepted by browser routes and origin grants. */
export function safeSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
