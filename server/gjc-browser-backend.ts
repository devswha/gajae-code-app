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
 * Aside retains its fixed error code/guard. Ego's unresolved-CLI state is
 * browser-only: the adapter keeps ordinary chat alive with a separate prompt
 * policy instead of throwing a session-start error.
 */

import { execFile as execFileCallback } from 'node:child_process';
import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';

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

/*
 * There is deliberately no ego-unavailable failure here.
 *
 * An ego run whose CLI is missing keeps ordinary chat and coding available and
 * only loses browser work: `applyGjcBrowserBackend` returns the unavailable
 * routing block, disables the runtime's browser tool and the app withholds its
 * own transport. Failing the session instead - and telling the user to pick
 * Built-in - was the opposite contract, and Built-in is not a fallback ego is
 * allowed to be replaced by.
 */

export type EgoBrowserCliProbe =
  | { ok: true; path: string }
  | { ok: false; searched: string[] };

export const EGO_BROWSER_COMMAND = 'ego-browser';
export const EGO_EXPECTED_BUNDLE_IDENTIFIER = 'com.citrolabs.ego.lite';

/** Ego Lite is currently a macOS-only integration. Keep this gate separate from
 * the native WebView gate: self-hosted macOS users may still use Ego without
 * the desktop browser surface. */
export function isEgoSupportedPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin';
}

export const EGO_VERSION_MATRIX = Object.freeze({
  // The beta.16 smoke established one known-good point. This is deliberately a
  // data table, not a compatibility promise: values absent from it stay
  // unknown until an explicit connection test observes them.
  app: Object.freeze({ supported: ['0.5.0.32'] as readonly string[] }),
  cli: Object.freeze({ supported: ['0.5.0.32'] as readonly string[] }),
  skill: Object.freeze({ supported: ['2.0.0'] as readonly string[] }),
});

export type EgoReadinessCode =
  | 'ego_not_supported_platform'
  | 'ego_cli_missing'
  | 'ego_cli_dangling'
  | 'ego_cli_not_executable'
  | 'ego_app_missing'
  | 'ego_app_not_running'
  | 'ego_skill_missing'
  | 'ego_skill_dangling'
  | 'ego_skills_untrusted'
  | 'ego_version_unknown'
  | 'ego_version_unsupported'
  | 'ego_not_connected'
  | 'ego_cli_app_skew'
  | 'ego_app_version_mismatch'
  | 'ego_app_untrusted';

export type EgoReadinessCheck = Readonly<{
  code: EgoReadinessCode;
  state: 'ok' | 'problem' | 'unknown';
  checked: boolean;
}>;

export type EgoReadinessReport = Readonly<{
  backend: 'ego';
  platform: NodeJS.Platform;
  supportedPlatform: boolean;
  checked: true;
  ready: boolean;
  status: 'ready' | 'not_ready' | 'unknown';
  checks: Readonly<Record<EgoReadinessCode, EgoReadinessCheck>>;
  /** Structured issues; no absolute path or user content is included. */
  issues: readonly EgoReadinessCheck[];
  /** Compact code-only view for clients that do not need check metadata. */
  issueCodes: readonly EgoReadinessCode[];
  warnings: readonly EgoReadinessCode[];
  versions: Readonly<{ cli: string | 'unknown'; app: string | 'unknown'; skill: string | 'unknown' }>;
  versionMatrix: typeof EGO_VERSION_MATRIX;
  cli: Readonly<{ state: 'ready' | 'missing' | 'dangling' | 'not_executable' | 'unknown' }>;
  app: Readonly<{ state: 'ready' | 'missing' | 'unknown' }>;
  skill: Readonly<{ state: 'ready' | 'missing' | 'dangling' | 'untrusted' | 'unknown' }>;
  appMetadata: Readonly<{ version: string | 'unknown'; bundleIdentifier: string | 'unknown' }>;
}>;

type EgoReadinessFileSystem = {
  lstatSync: typeof lstatSync;
  statSync: typeof statSync;
  accessSync: typeof accessSync;
  readlinkSync: typeof readlinkSync;
  realpathSync: typeof realpathSync;
  readFileSync: typeof readFileSync;
};

const defaultEgoReadinessFileSystem: EgoReadinessFileSystem = {
  lstatSync,
  statSync,
  accessSync,
  readlinkSync,
  realpathSync,
  readFileSync,
};

export type EgoReadinessProbeOptions = {
  home?: string;
  /** The exact agent directory used by the worker, not a hard-coded user path. */
  agentDir?: string;
  platform?: NodeJS.Platform;
  path?: string;
  fs?: Partial<EgoReadinessFileSystem>;
  /** Alias accepted by embedders that call the seam `filesystem`. */
  filesystem?: Partial<EgoReadinessFileSystem>;
};

type EgoPathState = 'missing' | 'dangling' | 'not_executable' | 'ready' | 'unknown';

function safePathState(filePath: string, fileSystem: EgoReadinessFileSystem, executable: boolean): EgoPathState {
  try {
    const entry = fileSystem.lstatSync(filePath);
    if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
      const target = String(fileSystem.readlinkSync(filePath));
      const targetPath = isAbsolute(target) ? target : resolve(dirname(filePath), target);
      try {
        const targetEntry = fileSystem.statSync(targetPath);
        if (typeof targetEntry.isFile !== 'function' || !targetEntry.isFile()) return 'not_executable';
      }
      catch { return 'dangling'; }
    } else if (typeof entry.isFile !== 'function' || !entry.isFile()) {
      return 'missing';
    }
    if (executable) fileSystem.accessSync(filePath, fsConstants.X_OK);
    return 'ready';
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EACCES') return executable ? 'not_executable' : 'unknown';
    return 'missing';
  }
}

function resolvedPathState(filePath: string, fileSystem: EgoReadinessFileSystem, executable: boolean): EgoPathState {
  // Test doubles from callers that only provide stat/access remain useful.
  try {
    return safePathState(filePath, fileSystem, executable);
  } catch {
    return 'unknown';
  }
}

function isContainedBy(root: string, target: string): boolean {
  const suffix = relative(root, target);
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix));
}

type EgoAppMetadata = { version?: string; bundleIdentifier?: string };

function readAppMetadata(filePath: string, fileSystem: EgoReadinessFileSystem): EgoAppMetadata {
  try {
    const text = String(fileSystem.readFileSync(filePath, 'utf8'));
    const version = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/u.exec(text)?.[1]?.trim();
    const bundleIdentifier = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/u.exec(text)?.[1]?.trim();
    return { ...(version ? { version } : {}), ...(bundleIdentifier ? { bundleIdentifier } : {}) };
  } catch {
    return {};
  }
}

function readSkillVersion(filePath: string, fileSystem: EgoReadinessFileSystem): string | undefined {
  try {
    const text = String(fileSystem.readFileSync(filePath, 'utf8'));
    const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(text)?.[1] ?? '';
    const match = /^\s*(?:metadata\.version|version):\s*["']?([^\s"']+)["']?\s*$/mu.exec(frontmatter);
    return match?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function versionCheck(
  version: string | undefined,
  supported: readonly string[],
): EgoReadinessCheck | undefined {
  if (!version) return { code: 'ego_version_unknown', state: 'unknown', checked: false };
  return supported.includes(version)
    ? undefined
    : { code: 'ego_version_unsupported', state: 'problem', checked: true };
}

function addCheck(
  checks: Partial<Record<EgoReadinessCode, EgoReadinessCheck>>,
  check: EgoReadinessCheck,
): void {
  checks[check.code] = check;
}

/**
 * Read-only Ego readiness inspection. It intentionally does not execute the
 * CLI, launch the app, repair symlinks, install anything, or write user files.
 * Connectivity and CLI/app skew remain unknown until the explicit Settings
 * connection test is clicked.
 */
export function probeEgoReadiness(options: EgoReadinessProbeOptions = {}): EgoReadinessReport {
  const home = options.home ?? homedir();
  const agentDir = options.agentDir ?? process.env.GJC_WORKER_AGENT_DIR ?? join(home, '.gjc', 'agent');
  const platform = options.platform ?? process.platform;
  const injectedFileSystem = options.fs ?? options.filesystem ?? {};
  const fileSystem = {
    ...defaultEgoReadinessFileSystem,
    ...injectedFileSystem,
    // A small injected fixture commonly supplies only statSync; use it for
    // lstat calls too rather than touching the host filesystem.
    lstatSync: injectedFileSystem.lstatSync ?? injectedFileSystem.statSync ?? defaultEgoReadinessFileSystem.lstatSync,
  };
  const checks: Partial<Record<EgoReadinessCode, EgoReadinessCheck>> = {};
  const versions = { cli: 'unknown' as const, app: 'unknown' as string | 'unknown', skill: 'unknown' as string | 'unknown' };

  if (!isEgoSupportedPlatform(platform)) {
    addCheck(checks, { code: 'ego_not_supported_platform', state: 'problem', checked: true });
  } else {
    addCheck(checks, { code: 'ego_not_supported_platform', state: 'ok', checked: true });
  }

  const cliCandidates = egoBrowserCliCandidates(home);
  const pathEntries = (options.path ?? process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const directory of pathEntries) {
    const candidate = resolve(directory, EGO_BROWSER_COMMAND);
    if (!cliCandidates.includes(candidate)) cliCandidates.push(candidate);
  }
  let cliState: EgoPathState = 'missing';
  let cliPath: string | undefined;
  for (const candidate of cliCandidates) {
    const state = resolvedPathState(candidate, fileSystem, true);
    if (state === 'ready') { cliState = state; cliPath = candidate; break; }
    if (state === 'dangling' && cliState === 'missing') cliState = state;
    else if (state === 'not_executable' && (cliState === 'missing' || cliState === 'dangling')) cliState = state;
  }
  if (cliState === 'ready') addCheck(checks, { code: 'ego_cli_missing', state: 'ok', checked: true });
  else if (cliState === 'dangling') addCheck(checks, { code: 'ego_cli_dangling', state: 'problem', checked: true });
  else if (cliState === 'not_executable') addCheck(checks, { code: 'ego_cli_not_executable', state: 'problem', checked: true });
  else addCheck(checks, { code: 'ego_cli_missing', state: 'problem', checked: true });

  const egoRoot = join(home, '.local', 'share', 'ego');
  const activeVersionDir = join(egoRoot, 'active_version_dir');
  let appState: 'ready' | 'missing' = 'missing';
  let appVersion: string | undefined;
  let activePath: string | undefined;
  try {
    const activeEntry = fileSystem.lstatSync(activeVersionDir);
    const activeTarget = typeof activeEntry.isSymbolicLink === 'function' && activeEntry.isSymbolicLink()
      ? String(fileSystem.readlinkSync(activeVersionDir))
      : activeVersionDir;
    activePath = isAbsolute(activeTarget) ? activeTarget : resolve(dirname(activeVersionDir), activeTarget);
    const activeStat = fileSystem.statSync(activePath);
    if (typeof activeStat.isDirectory === 'function' && !activeStat.isDirectory()) throw new Error('active version is not a directory');
    appState = 'ready';
    appVersion = /(?:^|[\\/])Versions[\\/]([^\\/]+)$/u.exec(activePath)?.[1];
  } catch {
    appState = 'missing';
  }
  // The app bundle path is stable across ego lite releases; a missing plist
  // leaves the app present but its version unknown rather than guessing.
  const appPlists = [
    join(egoRoot, 'ego lite.app', 'Contents', 'Info.plist'),
    join(home, 'Applications', 'ego lite.app', 'Contents', 'Info.plist'),
    join('/Applications', 'ego lite.app', 'Contents', 'Info.plist'),
  ];
  const activeBundleMatch = activePath
    ? /^(.*(?:^|[\\/])ego lite\.app)[\\/]Contents(?:[\\/]|$)/u.exec(activePath)
    : undefined;
  const activeAppPlist = activeBundleMatch
    ? join(activeBundleMatch[1], 'Contents', 'Info.plist')
    : undefined;
  // active_version_dir normally points inside the versioned framework under
  // the app bundle. Recover that bundle's own Info.plist so an unrelated
  // installed app cannot satisfy the version check.
  // (The variable is populated below when the active path was available.)
  let appInfoVersion: string | undefined;
  let appBundleIdentifier: string | undefined;
  const metadataPlists = [activeAppPlist, ...appPlists].filter((value): value is string => Boolean(value));
  for (const appPlist of metadataPlists) {
    const metadata = readAppMetadata(appPlist, fileSystem);
    appInfoVersion ??= metadata.version;
    appBundleIdentifier ??= metadata.bundleIdentifier;
  }
  appVersion ??= appInfoVersion;
  if (appState === 'ready') addCheck(checks, { code: 'ego_app_missing', state: 'ok', checked: true });
  else addCheck(checks, { code: 'ego_app_missing', state: 'problem', checked: true });
  versions.app = appVersion ?? 'unknown';

  const cliBindingVersion = cliPath
    ? (() => {
      try {
        const canonical = fileSystem.realpathSync(cliPath);
        return /(?:^|[\\/])Versions[\\/]([^\\/]+)[\\/]Helpers(?:[\\/]|$)/u.exec(canonical)?.[1];
      } catch { return undefined; }
    })()
    : undefined;

  // The active target is the authoritative versioned framework. A normal
  // bundle's Info.plist must agree with it and carry Ego Lite's fixed bundle
  // identifier. Mismatches are reported as state only; no path is returned.
  if (appVersion && appInfoVersion && appVersion !== appInfoVersion) {
    addCheck(checks, { code: 'ego_app_version_mismatch', state: 'problem', checked: true });
  }
  if (appBundleIdentifier !== undefined && appBundleIdentifier !== EGO_EXPECTED_BUNDLE_IDENTIFIER) {
    addCheck(checks, { code: 'ego_app_untrusted', state: 'problem', checked: true });
  } else if (appState === 'ready' && appBundleIdentifier === undefined) {
    addCheck(checks, { code: 'ego_app_untrusted', state: 'unknown', checked: false });
  }

  const skillPath = join(agentDir, 'skills', 'ego-browser', 'SKILL.md');
  let skillState: 'ready' | 'missing' | 'dangling' | 'untrusted' = 'missing';
  let skillVersion: string | undefined;
  try {
    const skillEntry = fileSystem.lstatSync(skillPath);
    if (typeof skillEntry.isSymbolicLink === 'function' && skillEntry.isSymbolicLink()) {
      const target = String(fileSystem.readlinkSync(skillPath));
      const targetPath = isAbsolute(target) ? target : resolve(dirname(skillPath), target);
      try {
        fileSystem.statSync(targetPath);
        let canonical = targetPath;
        try { canonical = fileSystem.realpathSync(targetPath); } catch { /* best effort */ }
        skillState = isContainedBy(egoRoot, canonical) ? 'ready' : 'untrusted';
      } catch { skillState = 'dangling'; }
    } else if (typeof skillEntry.isFile === 'function' && skillEntry.isFile()) {
      skillState = 'ready';
    }
    if (skillState === 'ready' || skillState === 'untrusted') skillVersion = readSkillVersion(skillPath, fileSystem);
  } catch {
    skillState = 'missing';
  }
  if (skillState === 'missing') addCheck(checks, { code: 'ego_skill_missing', state: 'problem', checked: true });
  else if (skillState === 'dangling') addCheck(checks, { code: 'ego_skill_dangling', state: 'problem', checked: true });
  else if (skillState === 'untrusted') addCheck(checks, { code: 'ego_skills_untrusted', state: 'problem', checked: true });
  else addCheck(checks, { code: 'ego_skill_missing', state: 'ok', checked: true });
  versions.skill = skillVersion ?? 'unknown';

  const appVersionCheck = versionCheck(appVersion, EGO_VERSION_MATRIX.app.supported);
  if (appVersionCheck) addCheck(checks, appVersionCheck);
  const skillVersionCheck = versionCheck(skillVersion, EGO_VERSION_MATRIX.skill.supported);
  if (skillVersionCheck && skillVersionCheck.state === 'problem') addCheck(checks, skillVersionCheck);
  if (versions.cli === 'unknown' || versions.app === 'unknown' || versions.skill === 'unknown') {
    addCheck(checks, { code: 'ego_version_unknown', state: 'unknown', checked: false });
  }

  // These states cannot be established from disk. They are deliberately
  // represented as warnings, never as a successful readiness claim.
  addCheck(checks, { code: 'ego_app_not_running', state: 'unknown', checked: false });
  addCheck(checks, { code: 'ego_not_connected', state: 'unknown', checked: false });
  addCheck(checks, {
    code: 'ego_cli_app_skew',
    state: cliBindingVersion && appVersion && cliBindingVersion !== appVersion ? 'problem' : 'unknown',
    checked: Boolean(cliBindingVersion && appVersion),
  });
  const observedChecks = Object.values(checks).filter((check): check is EgoReadinessCheck => Boolean(check));
  // A resolved path is retained only internally for this probe's control flow;
  // do not expose it in the structured report or route response.
  void cliPath;

  // Keep the public shape stable: each taxonomy code is always present, while
  // only `problem` entries appear in `issues` and unknown entries in warnings.
  for (const code of [
    'ego_not_supported_platform', 'ego_cli_missing', 'ego_cli_dangling', 'ego_cli_not_executable',
    'ego_app_missing', 'ego_app_not_running', 'ego_skill_missing', 'ego_skill_dangling',
    'ego_skills_untrusted', 'ego_version_unknown', 'ego_version_unsupported', 'ego_not_connected',
    'ego_cli_app_skew', 'ego_app_version_mismatch', 'ego_app_untrusted',
  ] as EgoReadinessCode[]) {
    if (!checks[code]) checks[code] = { code, state: 'unknown', checked: false };
  }
  const issueChecks = observedChecks.filter((check) => check.state === 'problem');
  const warnings = observedChecks.filter((check) => check.state === 'unknown').map((check) => check.code);
  const hasUnknown = warnings.length > 0;
  const ready = issueChecks.length === 0 && !hasUnknown;
  return {
    backend: 'ego', platform, supportedPlatform: isEgoSupportedPlatform(platform), checked: true,
    ready, status: ready ? 'ready' : issueChecks.length > 0 ? 'not_ready' : 'unknown',
    checks: checks as Record<EgoReadinessCode, EgoReadinessCheck>,
    issues: issueChecks,
    issueCodes: issueChecks.map((check) => check.code),
    warnings,
    versions,
    versionMatrix: EGO_VERSION_MATRIX,
    cli: { state: cliState === 'not_executable' ? 'not_executable' : cliState === 'dangling' ? 'dangling' : cliState === 'ready' ? 'ready' : 'missing' },
    app: { state: appState },
    skill: { state: skillState },
    appMetadata: { version: appInfoVersion ?? 'unknown', bundleIdentifier: appBundleIdentifier ?? 'unknown' },
  };
}

/** Candidate absolute paths for the `ego-browser` CLI, in priority order. ego lite onboarding registers it under `~/.local/bin`. */
export function egoBrowserCliCandidates(home = homedir()): string[] {
  return [resolve(home, '.local', 'bin', EGO_BROWSER_COMMAND)];
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
    const candidate = resolve(directory, EGO_BROWSER_COMMAND);
    if (isExecutable(candidate)) return { ok: true, path: candidate };
  }
  searched.push(`PATH (${EGO_BROWSER_COMMAND})`);
  return { ok: false, searched };
}

/**
 * Run the ego CLI once and return both streams.
 *
 * Two properties of `ego-browser` 0.5 make the obvious `promisify(execFile)`
 * wrong, and both were observed live:
 *
 * - it waits for EOF on stdin before running a `nodejs` program, so a child
 *   whose stdin stays an open pipe hangs until the timeout kills it. The
 *   parent therefore closes stdin immediately;
 * - when its output is piped it writes the program's own `console.log`, and
 *   its `--version` banner, to **stderr**. Callers must read both streams and
 *   decide on the content, never on which stream carried it.
 */
export const execEgoFile: EgoExecFile = (file, args, options) => new Promise((resolve, reject) => {
  const child = execFileCallback(file, [...args], options, (error, stdout, stderr) => {
    if (error) reject(error);
    else resolve({ stdout, stderr });
  });
  child.stdin?.end();
});

/** Everything the CLI wrote, in the order the streams are read. */
export function egoCliOutput(stdout: string | Buffer, stderr: string | Buffer): string {
  return `${String(stdout)}\n${String(stderr)}`;
}

const EGO_CONNECTION_TIMEOUT_MS = 2_000;
const EGO_CONNECTION_MAX_BUFFER = 16 * 1024;
const EGO_VERSION_OUTPUT = /^(?:ego-browser\s+)?v?(\d+(?:\.\d+){2,}(?:[-+][0-9A-Za-z.-]+)?)$/u;

export type EgoExecFile = (
  file: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    shell?: false;
    timeout?: number;
    killSignal?: NodeJS.Signals;
    maxBuffer?: number;
    windowsHide?: boolean;
  },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export type EgoConnectionTestResult = Readonly<{
  ok: boolean;
  status: 'connected' | 'not_connected' | 'failed';
  cliVersion?: string;
  errorCode?: EgoReadinessCode | 'ego_connection_failed';
  message?: string;
}>;

function connectionFailure(
  errorCode: EgoConnectionTestResult['errorCode'],
  status: EgoConnectionTestResult['status'],
  message: string,
  cliVersion?: string,
): EgoConnectionTestResult {
  return { ok: false, status, errorCode, message, ...(cliVersion ? { cliVersion } : {}) };
}

/**
 * The version banner: one version line, then only the CLI's own indented
 * component detail (`  chromium ...`, `  node ...`). Any other unindented line
 * is something else talking, and is rejected rather than parsed around.
 */
function strictVersionOutput(stdout: string | Buffer, stderr: string | Buffer): string | undefined {
  const lines = egoCliOutput(stdout, stderr).split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const [first, ...rest] = lines;
  if (!first || rest.some((line) => !/^\s/u.test(line))) return undefined;
  const match = EGO_VERSION_OUTPUT.exec(first.trim());
  return match?.[1];
}

function strictOkOutput(stdout: string | Buffer, stderr: string | Buffer): boolean {
  return egoCliOutput(stdout, stderr).trim() === 'ok';
}

/**
 * Run the two documented, non-mutating connection checks after an explicit
 * Settings click. The absolute path comes from the probe; shell execution is
 * disabled and the environment is intentionally minimal. No onboarding,
 * import, upgrade or repair command is ever issued here.
 */
export async function testEgoBrowserConnection(options: {
  home?: string;
  path?: string;
  platform?: NodeJS.Platform;
  probe?: () => EgoBrowserCliProbe;
  execFile?: EgoExecFile;
} = {}): Promise<EgoConnectionTestResult> {
  const home = options.home ?? homedir();
  const probe = options.probe ?? (() => probeEgoBrowserCli({ home, path: options.path }));
  if (!isEgoSupportedPlatform(options.platform ?? process.platform)) {
    return connectionFailure('ego_not_supported_platform', 'failed', 'ego lite is supported only on macOS.');
  }
  const found = probe();
  if (!found.ok) {
    return connectionFailure('ego_cli_missing', 'failed', 'The ego-browser CLI is not installed or executable.');
  }
  // Deliberately constrain PATH to the resolved CLI's directory plus the
  // platform basics. The command itself is still absolute and shell=false.
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    PATH: `${dirname(found.path)}${delimiter}/usr/bin${delimiter}/bin`,
    LANG: 'C',
    LC_ALL: 'C',
  };
  const execute = (options.execFile ?? execEgoFile) as EgoExecFile;
  let versionOutput: { stdout: string | Buffer; stderr: string | Buffer };
  try {
    versionOutput = await execute(found.path, ['--version'], {
      env, shell: false, timeout: EGO_CONNECTION_TIMEOUT_MS, killSignal: 'SIGKILL',
      maxBuffer: EGO_CONNECTION_MAX_BUFFER, windowsHide: true,
    });
  } catch {
    return connectionFailure('ego_connection_failed', 'failed', 'The ego-browser CLI version check failed.');
  }
  const cliVersion = strictVersionOutput(versionOutput.stdout, versionOutput.stderr);
  if (!cliVersion) return connectionFailure('ego_connection_failed', 'failed', 'The ego-browser CLI returned an invalid version response.');
  if (!EGO_VERSION_MATRIX.cli.supported.includes(cliVersion)) {
    return connectionFailure('ego_version_unsupported', 'failed', 'The installed ego-browser CLI version is not supported.', cliVersion);
  }

  let nodeOutput: { stdout: string | Buffer; stderr: string | Buffer };
  try {
    nodeOutput = await execute(found.path, ['nodejs', '-e', "console.log('ok')"], {
      env, shell: false, timeout: EGO_CONNECTION_TIMEOUT_MS, killSignal: 'SIGKILL',
      maxBuffer: EGO_CONNECTION_MAX_BUFFER, windowsHide: true,
    });
  } catch (error) {
    const detail = error instanceof Error && /updated|support.*nodejs|skew/iu.test(error.message)
      ? 'The ego-browser CLI and app versions are incompatible.'
      : 'ego-browser could not connect to the running ego lite app.';
    return connectionFailure(
      detail.includes('incompatible') ? 'ego_cli_app_skew' : 'ego_not_connected',
      'not_connected', detail, cliVersion,
    );
  }
  if (!strictOkOutput(nodeOutput.stdout, nodeOutput.stderr)) {
    const output = `${String(nodeOutput.stdout)}\n${String(nodeOutput.stderr)}`;
    const skew = /updated|support.*nodejs|repl|version/iu.test(output);
    return connectionFailure(
      skew ? 'ego_cli_app_skew' : 'ego_not_connected',
      'not_connected',
      skew ? 'The ego-browser CLI and app versions are incompatible.' : 'ego-browser could not connect to the running ego lite app.',
      cliVersion,
    );
  }
  return { ok: true, status: 'connected', cliVersion };
}

/** POSIX single-quote escaping for an already-resolved executable path. */
export function quotePosixShellPath(filePath: string): string {
  return `'${filePath.replaceAll("'", "'\\''")}'`;
}

/** Only an app-minted token may be interpolated into the naming rule. */
const EGO_ACTIVITY_TOKEN_SHAPE = /^gjc-[0-9a-f]{8}$/u;

/**
 * App-owned routing block for the ego backend, appended to the system prompt
 * the way the runtime appends its own Aside block. The executable path comes
 * from the probe and is quoted before interpolation, so the shell runs the
 * exact file that was checked rather than resolving a bare name again.
 *
 * `activityToken` is the app-minted session label (`egoActivityToken`) the
 * space name must carry, so the app can attribute a live ego space to this
 * session without parsing Bash commands. An unrecognized token is dropped
 * rather than written into the prompt.
 */
export function buildGjcEgoBrowserInstructions(cliPath: string, activityToken?: string): string {
  const command = quotePosixShellPath(cliPath);
  const token = activityToken && EGO_ACTIVITY_TOKEN_SHAPE.test(activityToken) ? activityToken : undefined;
  const naming = token
    ? `\n- Name that space \`"${token} <short goal>"\` - exactly this session's token, then a few plain words. The app matches the prefix to show what the browser is doing; a space without it is shown to nobody, and the token is a label only, never something to type into a page.`
    : '';
  return `<browser-backend>
Browser backend: ego lite (ego-browser CLI). The built-in browser tool is disabled by configuration. NEVER use or register an MCP browser server, and never launch Playwright, Puppeteer or another browser.

Routing:
- Every task that requires a rendered page, authenticated/private browser state, live tabs, browser UI, screenshots, downloads behind cookies, or profile data MUST use Bash to invoke the verified executable ${command}: ${command} nodejs <<'EOF' ... EOF (or ${command} nodejs -e '<code>' when heredocs are unavailable).
- Cookie-free public HTTP content that does not require rendered or authenticated browser state may use GJC \`read\` directly.

Procedure:
- Load the installed \`ego-browser\` skill before the first browser action; it is the complete API reference (TaskSpace, Page, FileChooser, mouse, keyboard). Use only the API it lists, never inferred Playwright methods.
- Use exactly one TaskSpace per user goal: create it once with \`taskSpace(name)\`, print its \`spaceId\`, and resume that same space in later invocations with \`taskSpace(id)\`. Every invocation is a fresh Node.js process; spaces, tabs and Page labels persist, JavaScript variables do not.${naming}
- Print results with \`console.log\`; returned values are not emitted. Take a \`page.snapshot()\` before acting, prefer refs from that snapshot, and verify every meaningful action with a fresh URL/title, snapshot or screenshot.
- When the task succeeds, call \`await task.finish({ keep: [] })\` exactly once. Do not call \`finish()\` after a hand-off to the user or an error.

Safety:
- ego lite controls the user's live, logged-in browser profile. Never print cookies, authorization headers, passwords, OTPs, card values, recovery material, or broad inbox/contact/history collections.
- Never invoke \`ego-browser import\`, \`ego-browser upgrade\` or \`ego-browser onboarding\`; profile/cookie import, app upgrades and onboarding are user actions, not agent actions.
- Never substitute the built-in browser, Aside, an OS browser, Playwright, Puppeteer, an MCP browser server, or the \`computer\`/CUA tool for browser work. The \`computer\` tool is available only for legitimate non-browser app automation.
- Read, inspect, draft and preview by default. Sending/posting, payments, credential saves, account/settings changes, deletions and downloads to an external destination require explicit user intent for the exact target; stop before the final side effect when authorization is ambiguous.
- Stop when the user takes control of the space (\`handOff\`, inactive or unassigned space); do not retry or route around it.
- Never claim browser work ran without the ego-browser CLI result and verified state.
</browser-backend>`;
}

/** The historical export remains useful to callers that only need invariants. */
export const GJC_EGO_BROWSER_INSTRUCTIONS = buildGjcEgoBrowserInstructions(join(homedir(), '.local', 'bin', EGO_BROWSER_COMMAND));

/** Prompt policy used when filesystem readiness cannot support Ego browser work. */
export const GJC_EGO_BROWSER_UNAVAILABLE_INSTRUCTIONS = `<browser-backend>
Browser backend: ego lite is not ready, so browser work is unavailable for this run. Ordinary chat, coding and other non-browser work may continue.

Do not substitute any browser path: never use the built-in browser, Aside, an OS browser, Playwright, Puppeteer, an MCP browser server, or the \`computer\`/CUA tool for browser work. The \`computer\` tool remains available only for legitimate non-browser app automation; never open, inspect or control a browser with it.

If the user asks for browser work, stop that part and clearly explain that ego lite is unavailable. Do not invoke \`ego-browser import\`, \`ego-browser upgrade\` or \`ego-browser onboarding\`; do not install, repair, migrate profiles or route around the missing backend.
</browser-backend>`;
