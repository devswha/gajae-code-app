import path from 'node:path';

/**
 * `/export` output-path containment.
 *
 * The upstream handler passes `command.args` straight to
 * `session.exportToHtml(arg || undefined)`, which resolves through
 * `Bun.write(opts.outputPath || \`${APP_NAME}-session-<id>.html\`)` — a
 * RELATIVE path. Relative paths resolve against the worker process cwd, and
 * the worker is a single long-lived process shared by every session
 * (`GjcWorkerSupervisor` keeps one child for the API server's lifetime), so
 * its cwd is whatever directory the API server was launched from — under a
 * current-worktree launch, the real repository.
 *
 * The fix therefore cannot live on the worker spawn: binding that
 * process-wide cwd to a session would pin every later session's export to
 * whichever session happened to start the worker. It has to be resolved
 * per run, at the command boundary, from the run's own `config.cwd`.
 *
 * This module rewrites the command text so the argument is an absolute path
 * contained inside the run's project directory, and rejects arguments that
 * would escape it.
 */

/** Mirrors `APP_NAME` in @gajae-code/utils, used by the upstream default name. */
const APP_NAME = 'gjc';

/**
 * Clipboard aliases the upstream handler rejects with its own usage message
 * before they ever reach `exportToHtml`. They are not output paths and must
 * pass through untouched. Mirrors `builtin-registry.ts` export handler.
 */
const CLIPBOARD_ALIASES: ReadonlySet<string> = new Set(['--copy', 'clipboard', 'copy']);

const EXPORT_COMMAND = /^\/export(?:\s+([\s\S]*))?$/;

export type ExportPathResolution =
  /** Not an /export invocation, or one this module deliberately leaves alone. */
  | { kind: 'passthrough' }
  /** Rewritten so the handler receives an absolute, contained output path. */
  | { kind: 'contained'; message: string; outputPath: string }
  /** The requested path escapes the project directory; do not run the export. */
  | { kind: 'rejected'; reason: string };

/**
 * True when `candidate` is `root` itself or lies underneath it. Purely lexical:
 * both inputs must already be absolute and normalized. Symlink escapes are the
 * filesystem layer's problem, not this one's.
 */
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Reproduces the upstream default export filename so a bare `/export` keeps
 * its familiar name while gaining an explicit, contained directory.
 */
export function defaultExportFileName(sessionFile: string): string {
  return `${APP_NAME}-session-${path.basename(sessionFile, '.jsonl')}.html`;
}

/**
 * Resolves the output path for an `/export` invocation against the run's own
 * project directory.
 *
 * - bare `/export`               -> `<cwd>/gjc-session-<id>.html`
 * - relative `/export out.html`  -> `<cwd>/out.html`
 * - absolute `/export /tmp/x`    -> untouched; an absolute path is a deliberate
 *                                   destination, not the ambient-cwd defect.
 * - clipboard aliases            -> untouched; upstream owns that diagnostic.
 *
 * Relative paths that climb out of `cwd` are rejected rather than silently
 * written outside the project.
 */
export function resolveContainedExportCommand(
  message: string,
  cwd: string,
  sessionFile: string | null | undefined,
): ExportPathResolution {
  const match = EXPORT_COMMAND.exec(message.trim());
  if (!match) return { kind: 'passthrough' };

  const arg = (match[1] ?? '').trim();
  if (CLIPBOARD_ALIASES.has(arg)) return { kind: 'passthrough' };

  // An absolute destination is explicit user intent and is left as-is.
  if (arg && path.isAbsolute(arg)) return { kind: 'passthrough' };

  // Without a usable project root there is nothing to contain the write to.
  // Refusing beats writing into the server's launch directory.
  if (!cwd || !path.isAbsolute(cwd)) {
    return {
      kind: 'rejected',
      reason: 'Cannot export: this session has no resolved project directory to write into.',
    };
  }

  // An in-memory session has no default name; upstream raises its own error.
  if (!arg && !sessionFile) return { kind: 'passthrough' };

  const target = arg || defaultExportFileName(sessionFile as string);
  const projectRoot = path.resolve(cwd);
  const outputPath = path.resolve(projectRoot, target);

  if (!isInside(projectRoot, outputPath)) {
    return {
      kind: 'rejected',
      reason:
        `Cannot export to "${target}": the resolved path escapes the project directory. ` +
        'Use a path inside the project, or pass an absolute path to export elsewhere.',
    };
  }

  return { kind: 'contained', message: `/export ${outputPath}`, outputPath };
}
