/** Application-facing browser backend vocabulary shared by Settings and its contract test. */
export const BROWSER_BACKENDS = ['builtin', 'aside', 'ego'] as const;
export type BrowserBackend = typeof BROWSER_BACKENDS[number];

export function isBrowserBackend(value: unknown): value is BrowserBackend {
  return typeof value === 'string' && (BROWSER_BACKENDS as readonly string[]).includes(value);
}
