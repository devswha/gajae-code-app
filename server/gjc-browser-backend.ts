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
 * `ego` (PoC) is the one backend the runtime does not know. The runtime keeps
 * `native` so no Aside routing is injected, the app hides every built-in browser
 * tool (`browser.enabled=false`, the WebView transport withheld) and appends its
 * own `<browser-backend>` block that routes browser work through the
 * user-installed `ego-browser` CLI (ego lite, https://github.com/citrolabs/ego-lite)
 * via Bash. The agent-facing API lives in the user-installed `ego-browser`
 * skill; the app ships neither a tool nor a skill copy for it.
 *
 * Mirrors `gjc-model-resolution.ts`: one application error code, fixed text
 * that is safe to relay to a browser because it carries no frame content, an
 * error class the adapter throws, and a guard the worker answers with.
 */

import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** Application choices do not expose the runtime's `native` setting value. */
export const GJC_BROWSER_BACKENDS = ['builtin', 'aside', 'ego'] as const;
export type GjcBrowserBackend = typeof GJC_BROWSER_BACKENDS[number];
export const DEFAULT_GJC_BROWSER_BACKEND: GjcBrowserBackend = 'builtin';

export function isGjcBrowserBackend(value: unknown): value is GjcBrowserBackend {
  return typeof value === 'string' && (GJC_BROWSER_BACKENDS as readonly string[]).includes(value);
}

/** Application error code a worker answers a run with when Aside is selected but no Aside CLI is installed. */
export const GJC_ASIDE_UNAVAILABLE_CODE = 'aside_unavailable';
/** Fixed text for that failure; safe to relay to a browser because it carries no frame content. */
export const GJC_ASIDE_UNAVAILABLE_MESSAGE = 'The Aside CLI was not found, so this session cannot start with the Aside browser backend. Install the Aside CLI, or choose Built-in in Settings > Automation where it is available.';

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

/** Application error code a worker answers a run with when ego is selected but no `ego-browser` CLI is installed. */
export const GJC_EGO_UNAVAILABLE_CODE = 'ego_unavailable';
/** Fixed text for that failure; safe to relay to a browser because it carries no frame content. */
export const GJC_EGO_UNAVAILABLE_MESSAGE = 'The ego-browser CLI was not found, so this session cannot start with the ego browser backend. Install ego lite and finish its onboarding, or choose Built-in in Settings > Automation where it is available.';

export class GjcEgoUnavailableError extends Error {
  readonly code = GJC_EGO_UNAVAILABLE_CODE;

  constructor(readonly searched: readonly string[] = []) {
    super(GJC_EGO_UNAVAILABLE_MESSAGE);
    this.name = 'GjcEgoUnavailableError';
  }
}

export function isGjcEgoUnavailableError(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === GJC_EGO_UNAVAILABLE_CODE;
}

export type EgoBrowserCliProbe =
  | { ok: true; path: string }
  | { ok: false; searched: string[] };

export const EGO_BROWSER_COMMAND = 'ego-browser';

/** Candidate absolute paths for the `ego-browser` CLI, in priority order. ego lite onboarding registers it under `~/.local/bin`. */
export function egoBrowserCliCandidates(home = homedir()): string[] {
  return [join(home, '.local', 'bin', EGO_BROWSER_COMMAND)];
}

function isExecutableFile(filePath: string): boolean {
  try {
    if (!statSync(filePath).isFile()) return false;
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe-only discovery of the user-installed `ego-browser` CLI: the onboarding
 * location first, then the current process `PATH`. Never runs an installer and
 * never executes the CLI. Portable across the Node server and the Bun worker.
 */
export function probeEgoBrowserCli(
  options: { home?: string; path?: string; isExecutable?: (filePath: string) => boolean } = {},
): EgoBrowserCliProbe {
  const isExecutable = options.isExecutable ?? isExecutableFile;
  const searched: string[] = [];
  for (const candidate of egoBrowserCliCandidates(options.home)) {
    searched.push(candidate);
    if (isExecutable(candidate)) return { ok: true, path: candidate };
  }
  const pathEntries = (options.path ?? process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const directory of pathEntries) {
    const candidate = join(directory, EGO_BROWSER_COMMAND);
    if (isExecutable(candidate)) return { ok: true, path: candidate };
  }
  searched.push(`PATH (${EGO_BROWSER_COMMAND})`);
  return { ok: false, searched };
}

/**
 * App-owned routing block for the ego backend, appended to the system prompt
 * the way the runtime appends its own Aside block. It names the CLI entry
 * point and the skill that carries the API; the skill, not this block, is the
 * API reference.
 */
export const GJC_EGO_BROWSER_INSTRUCTIONS = `<browser-backend>
Browser backend: ego lite (ego-browser CLI). The built-in browser tool is disabled by configuration. NEVER use or register an MCP browser server, and never launch Playwright, Puppeteer or another browser.

Routing:
- Every task that requires a rendered page, authenticated/private browser state, live tabs, browser UI, screenshots, downloads behind cookies, or profile data MUST use Bash to invoke the installed \`ego-browser\` CLI: \`ego-browser nodejs <<'EOF' ... EOF\` (or \`ego-browser nodejs -e '<code>'\` when heredocs are unavailable).
- Cookie-free public HTTP content that does not require rendered or authenticated browser state may use GJC \`read\` directly.

Procedure:
- Load the installed \`ego-browser\` skill before the first browser action; it is the complete API reference (TaskSpace, Page, FileChooser, mouse, keyboard). Use only the API it lists, never inferred Playwright methods.
- Use exactly one TaskSpace per user goal: create it once with \`taskSpace(name)\`, print its \`spaceId\`, and resume that same space in later invocations with \`taskSpace(id)\`. Every invocation is a fresh Node.js process; spaces, tabs and Page labels persist, JavaScript variables do not.
- Print results with \`console.log\`; returned values are not emitted. Take a \`page.snapshot()\` before acting, prefer refs from that snapshot, and verify every meaningful action with a fresh URL/title, snapshot or screenshot.
- When the task succeeds, call \`await task.finish({ keep: [] })\` exactly once. Do not call \`finish()\` after a hand-off to the user or an error.

Safety:
- ego lite controls the user's live, logged-in browser profile. Never print cookies, authorization headers, passwords, OTPs, card values, recovery material, or broad inbox/contact/history collections.
- Read, inspect, draft and preview by default. Sending/posting, payments, credential saves, account/settings changes, deletions and downloads to an external destination require explicit user intent for the exact target; stop before the final side effect when authorization is ambiguous.
- Stop when the user takes control of the space (\`handOff\`, inactive or unassigned space); do not retry or route around it.
- Never claim browser work ran without the ego-browser CLI result and verified state.
</browser-backend>`;
