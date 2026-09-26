import path from 'node:path';

/**
 * `/export` output-path resolution.
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
 * resolved against the run's project directory - the directory the GJC CLI
 * would have been started in - so `/export` writes exactly where it would in
 * the CLI, including paths that climb out of the project.
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
  /** Rewritten so the handler receives an absolute output path. */
  | { kind: 'resolved'; message: string; outputPath: string }
  /** The run has no project directory to resolve against; do not run the export. */
  | { kind: 'rejected'; reason: string };

/**
 * Reproduces the upstream default export filename so a bare `/export` keeps
 * its familiar name while gaining an explicit directory.
 */
export function defaultExportFileName(sessionFile: string): string {
  return `${APP_NAME}-session-${path.basename(sessionFile, '.jsonl')}.html`;
}

/**
 * Resolves the output path for an `/export` invocation against the run's own
 * project directory, the way the CLI resolves it against its working directory.
 *
 * - bare `/export`               -> `<cwd>/gjc-session-<id>.html`
 * - relative `/export out.html`  -> `<cwd>/out.html`
 * - relative `/export ../x.html` -> `<parent of cwd>/x.html`
 * - absolute `/export /tmp/x`    -> untouched
 * - clipboard aliases            -> untouched; upstream owns that diagnostic.
 */
export function resolveExportCommand(
  message: string,
  cwd: string,
  sessionFile: string | null | undefined,
): ExportPathResolution {
  const match = EXPORT_COMMAND.exec(message.trim());
  if (!match) return { kind: 'passthrough' };

  const arg = (match[1] ?? '').trim();
  if (CLIPBOARD_ALIASES.has(arg)) return { kind: 'passthrough' };

  // An absolute destination needs no resolution.
  if (arg && path.isAbsolute(arg)) return { kind: 'passthrough' };

  // Without a usable project directory a relative path would land in the
  // server's launch directory, which is not where the user's session runs.
  if (!cwd || !path.isAbsolute(cwd)) {
    return {
      kind: 'rejected',
      reason: 'Cannot export: this session has no resolved project directory to write into.',
    };
  }

  // An in-memory session has no default name; upstream raises its own error.
  if (!arg && !sessionFile) return { kind: 'passthrough' };

  const outputPath = path.resolve(cwd, arg || defaultExportFileName(sessionFile as string));
  return { kind: 'resolved', message: `/export ${outputPath}`, outputPath };
}
