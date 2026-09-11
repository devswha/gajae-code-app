/**
 * The browser backend a GJC run starts with.
 *
 * The runtime (`@gajae-code/coding-agent`) owns the browser backend contract:
 * `browser.backend` is one of its settings, `native` exposes its built-in
 * browser tool, and `aside` hides that tool and appends the runtime's own
 * `<browser-backend>` routing block, which sends every rendered/authenticated
 * browser task through the user-installed Aside CLI via Bash. The app does not
 * reimplement any of that; it only decides which value the run's settings
 * carry, and refuses to start an Aside run when the runtime's own CLI probe
 * finds no Aside installation, because a session that silently falls back to
 * the app's Chromium would act in the wrong browser profile.
 *
 * Mirrors `gjc-model-resolution.ts`: one application error code, fixed text
 * that is safe to relay to a browser because it carries no frame content, an
 * error class the adapter throws, and a guard the worker answers with.
 */

export const GJC_BROWSER_BACKENDS = ['native', 'aside'] as const;
export type GjcBrowserBackend = typeof GJC_BROWSER_BACKENDS[number];
export const DEFAULT_GJC_BROWSER_BACKEND: GjcBrowserBackend = 'native';

export function isGjcBrowserBackend(value: unknown): value is GjcBrowserBackend {
  return typeof value === 'string' && (GJC_BROWSER_BACKENDS as readonly string[]).includes(value);
}

/** Application error code a worker answers a run with when Aside is selected but no Aside CLI is installed. */
export const GJC_ASIDE_UNAVAILABLE_CODE = 'aside_unavailable';
/** Fixed text for that failure; safe to relay to a browser because it carries no frame content. */
export const GJC_ASIDE_UNAVAILABLE_MESSAGE = 'The Aside CLI was not found, so this session cannot start with the Aside browser backend. Install the Aside CLI, or switch Browser backend back to Native in Settings > Automation.';

export class GjcAsideUnavailableError extends Error {
  readonly code = GJC_ASIDE_UNAVAILABLE_CODE;

  constructor(readonly searched: readonly string[] = []) {
    super(GJC_ASIDE_UNAVAILABLE_MESSAGE);
    this.name = 'GjcAsideUnavailableError';
  }
}

export function isGjcAsideUnavailableError(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === GJC_ASIDE_UNAVAILABLE_CODE;
}
