/**
 * What the agent's ego lite browser is doing right now, read from ego itself.
 *
 * The ego backend routes browser work through the user-installed `ego-browser`
 * CLI (`docs/BROWSER-EGO-POC.md`), so a run's browser state is invisible to the
 * runtime: a Bash call carries an opaque command string, and the CLI buffers
 * the model's own output until the round exits. ego lite, however, answers
 * `listTaskSpaces()` / `tabs()` from any process in ~0.12-0.17 s without
 * disturbing a script that is mid-action in the same space, so the app can
 * render ego-authoritative state instead of parsing commands or trusting
 * model prose. The design record is `docs/plans/ego-activity-contract.md`.
 *
 * Boundaries this module exists to keep:
 *
 * - the observation script is a fixed app-authored constant. No model text, no
 *   session data and no caller input is ever interpolated into it;
 * - it calls only the read-only API allowlist: `listTaskSpaces`, `taskSpace`
 *   and `tabs`. Never `goto`, `click`, `evaluate`, `cdp`, `adopt`, `claim`,
 *   `takeOver`, `handOff`, `finish`, `close`, `import`, `upgrade` or
 *   `onboarding`, and never `page.events()`, whose read *clears* the buffer the
 *   agent's own script depends on;
 * - only agent-created, agent-owned spaces whose name carries an app-minted
 *   session token are read, and inside them only agent-opened managed pages.
 *   The user's own tabs and spaces never leave ego;
 * - every failure is soft: the surface disappears, the run is untouched.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

/** Prefix of every app-minted ego space token; also the script-side filter. */
export const EGO_ACTIVITY_TOKEN_PREFIX = 'gjc-';

const EGO_ACTIVITY_TIMEOUT_MS = 6_000;
const EGO_ACTIVITY_MAX_BUFFER = 256 * 1024;
/** Bounds on what may be rendered, applied after the CLI returns. */
const MAX_SPACES = 4;
const MAX_PAGES = 8;
const MAX_TITLE_CHARS = 120;
const MAX_NAME_CHARS = 80;
const MAX_URL_CHARS = 200;

/**
 * The session token an ego space name must start with.
 *
 * Derived, not stored: the worker builds the routing block from the app
 * session id and the server recomputes the same value when it attributes a
 * space, so nothing has to be persisted or handed across the worker protocol.
 * It is a label, never a capability - it authorizes nothing and carries no
 * session content.
 */
export function egoActivityToken(appSessionId: string): string {
  const digest = createHash('sha256').update(String(appSessionId)).digest('hex').slice(0, 8);
  return `${EGO_ACTIVITY_TOKEN_PREFIX}${digest}`;
}

/** True when a space name was minted for this session. */
export function matchesEgoActivityToken(spaceName: unknown, token: string): boolean {
  return typeof spaceName === 'string' && spaceName.startsWith(token);
}

/**
 * The complete observation program. It is a constant on purpose: a template
 * that interpolated anything would put app, session or model text inside a
 * JavaScript program that runs against the user's logged-in browser.
 */
export const EGO_ACTIVITY_SCRIPT = `const spaces = await listTaskSpaces();
const out = [];
for (const space of Array.isArray(spaces) ? spaces : []) {
  if (out.length >= ${MAX_SPACES}) break;
  if (space.createdBy !== "agent" || space.ownership !== "agent") continue;
  if (typeof space.name !== "string" || !space.name.startsWith("${EGO_ACTIVITY_TOKEN_PREFIX}")) continue;
  let tabs = [];
  try {
    const task = await taskSpace(space.id);
    tabs = await task.tabs();
  } catch {
    continue;
  }
  const pages = [];
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    if (!tab || tab.openedBy !== "agent" || typeof tab.label !== "string" || !tab.label) continue;
    pages.push({ label: tab.label, url: tab.url, title: tab.title, active: tab.active === true });
  }
  out.push({ id: space.id, name: space.name, pages });
}
console.log(JSON.stringify({ v: 1, spaces: out }));`;

export type EgoActivityPage = Readonly<{
  /** ego's durable managed-page label (`p1`, `p2`, ...). */
  label: string;
  /** Origin and path only; query strings and fragments carry tokens and are dropped. */
  url: string;
  title: string;
  active: boolean;
}>;

export type EgoActivitySpace = Readonly<{
  id: number;
  /** The app-minted token the space name starts with; server-side attribution only. */
  token: string;
  /** The model's goal text with the app token removed; never the profile name. */
  name: string;
  pages: readonly EgoActivityPage[];
}>;

export type EgoActivitySnapshot = Readonly<{
  spaces: readonly EgoActivitySpace[];
  /** Set when the CLI could not be read; the surface hides instead of guessing. */
  unavailable?: true;
}>;

export const EMPTY_EGO_ACTIVITY: EgoActivitySnapshot = Object.freeze({ spaces: [] });

export type EgoActivityExecFile = (
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; encoding: 'utf8'; env: NodeJS.ProcessEnv; shell: false },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

const execEgoFile = promisify(execFileCallback) as unknown as EgoActivityExecFile;

/** Query strings and fragments are dropped: session tokens live there. */
function safeUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    const parsed = new URL(value);
    // `origin` is the string "null" for non-web schemes such as about: and chrome:.
    const base = parsed.origin && parsed.origin !== 'null' ? parsed.origin : parsed.protocol;
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${base}${path}`.slice(0, MAX_URL_CHARS);
  } catch {
    return '';
  }
}

function safeText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, max) : '';
}

/** Split `"<token> <goal>"` into the token and the user-facing goal text. */
function splitSpaceName(name: string): { token: string; label: string } {
  const separator = name.indexOf(' ');
  if (separator <= 0) return { token: name, label: '' };
  return {
    token: name.slice(0, separator),
    label: name.slice(separator + 1).replace(/^[\s\u00b7:\-\u2013\u2014]+/u, ''),
  };
}

function parsePages(value: unknown): EgoActivityPage[] {
  if (!Array.isArray(value)) return [];
  const pages: EgoActivityPage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const page = entry as Record<string, unknown>;
    const label = safeText(page.label, 16);
    if (!label) continue;
    pages.push({
      label,
      url: safeUrl(page.url),
      title: safeText(page.title, MAX_TITLE_CHARS),
      active: page.active === true,
    });
    if (pages.length >= MAX_PAGES) break;
  }
  return pages;
}

/**
 * Shape-check and bound the CLI's answer. Anything unexpected yields an empty
 * snapshot rather than a partially trusted one.
 */
export function parseEgoActivityOutput(stdout: string): EgoActivitySnapshot {
  const line = stdout.split('\n').map((entry) => entry.trim()).filter(Boolean).pop();
  if (!line) return EMPTY_EGO_ACTIVITY;
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return EMPTY_EGO_ACTIVITY;
  }
  if (!payload || typeof payload !== 'object') return EMPTY_EGO_ACTIVITY;
  const record = payload as Record<string, unknown>;
  if (record.v !== 1 || !Array.isArray(record.spaces)) return EMPTY_EGO_ACTIVITY;
  const spaces: EgoActivitySpace[] = [];
  for (const entry of record.spaces) {
    if (!entry || typeof entry !== 'object') continue;
    const space = entry as Record<string, unknown>;
    if (typeof space.id !== 'number' || !Number.isSafeInteger(space.id)) continue;
    const name = typeof space.name === 'string' ? space.name : '';
    if (!name.startsWith(EGO_ACTIVITY_TOKEN_PREFIX)) continue;
    const { token, label } = splitSpaceName(name);
    spaces.push({
      id: space.id,
      token,
      // The token is plumbing; the user sees the goal the model named.
      name: safeText(label, MAX_NAME_CHARS),
      pages: parsePages(space.pages),
    });
    if (spaces.length >= MAX_SPACES) break;
  }
  return { spaces };
}

/**
 * Run the fixed observation script once against the probe-resolved CLI.
 *
 * `cliPath` is the absolute path `probeEgoBrowserCli` already verified; it is
 * executed with `shell: false` and a minimal environment, so no shell parses
 * it and no user environment reaches ego.
 */
/** The spaces this session minted; attribution never guesses at an unlabelled space. */
export function selectEgoActivitySpaces(
  snapshot: EgoActivitySnapshot,
  token: string,
): readonly EgoActivitySpace[] {
  return snapshot.spaces.filter((space) => space.token === token);
}

export async function readEgoActivity(options: {
  cliPath: string;
  execFile?: EgoActivityExecFile;
  env?: NodeJS.ProcessEnv;
}): Promise<EgoActivitySnapshot> {
  const exec = options.execFile ?? execEgoFile;
  try {
    const { stdout } = await exec(options.cliPath, ['nodejs', '-e', EGO_ACTIVITY_SCRIPT], {
      timeout: EGO_ACTIVITY_TIMEOUT_MS,
      maxBuffer: EGO_ACTIVITY_MAX_BUFFER,
      encoding: 'utf8',
      shell: false,
      env: {
        PATH: options.env?.PATH ?? '/usr/bin:/bin',
        HOME: options.env?.HOME ?? '',
      },
    });
    return parseEgoActivityOutput(String(stdout));
  } catch {
    // A broken, upgrading or closed ego lite must never surface as an error in
    // a coding session; the panel simply has nothing to show.
    return { spaces: [], unavailable: true };
  }
}
