/**
 * Asks before a run rewrites git state in a checkout it does not own.
 *
 * A session that chose the project location runs in the same working tree the
 * user and every other session of that project are looking at. Committing,
 * switching branches or resetting there is not a private act: it moves `HEAD`
 * and the index underneath whoever else is reading the directory. That is the
 * failure this guards - on 2026-09-17 an unattended run committed, pushed and
 * switched branches in a shared checkout while a second session was mid-read,
 * and nothing asked.
 *
 * A session in its own managed worktree owns the git state *under that
 * checkout*: an ordinary commit inside it is its own business. Walking out -
 * `git -C ../.. commit`, `cd <repository> && git push`, a redirected
 * `--git-dir` - touches a checkout other readers depend on, so it asks too.
 *
 * This is a prompt, not a sandbox. The command text is matched, and text can
 * be written to defeat matching; a run that wants to escape can. What it stops
 * is the ordinary case - a capable model doing exactly what it was asked, in
 * the directory it was given, with nobody told. The runtime owns actual
 * containment.
 */

import path from 'node:path';

/** Tokens that make a `git` invocation rewrite state the whole checkout shares. */
const GIT_STATE_SUBCOMMANDS = new Set([
  'commit',
  'push',
  'checkout',
  'switch',
  'branch',
  'merge',
  'rebase',
  'reset',
  'revert',
  'cherry-pick',
  'stash',
  'clean',
  'restore',
  'am',
  'apply',
  'pull',
  'fetch',
  'worktree',
  'submodule',
  'gc',
  'prune',
  'filter-branch',
]);

/**
 * Flags that take a value, so the token after them is that value and must not
 * be read as the subcommand. `git -C /elsewhere commit` is still a commit.
 */
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);

/** Shell operators that end one command and begin another. */
const COMMAND_SEPARATORS = /(?:\|\||&&|[;|&\n])/;

/**
 * The subcommand of a single `git ...` invocation, or `null` when the segment
 * does not run git. Leading environment assignments and wrappers are skipped
 * so `GIT_DIR=x git commit` and `sudo git push` are still seen.
 */
function gitSubcommand(segment: string): string | null {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let index = 0;
  // `VAR=value` prefixes and common wrappers sit in front of the real command.
  while (index < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]!) || tokens[index] === 'sudo' || tokens[index] === 'command' || tokens[index] === 'env')) index += 1;
  const head = tokens[index];
  if (!head) return null;
  // Accept `git`, `/usr/bin/git` and `git.exe`; reject `mygit` or `gitk`.
  if (!/(?:^|\/)git(?:\.exe)?$/.test(head)) return null;
  index += 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (GIT_VALUE_FLAGS.has(token)) { index += 2; continue; }
    if (token.startsWith('-')) { index += 1; continue; }
    return token.toLowerCase();
  }
  // `git` with only flags (`git --version`) changes nothing.
  return null;
}

/**
 * Whether a bash command line rewrites shared git state.
 *
 * Every `&&`/`||`/`;`/`|` segment is examined, because the mutation is often
 * the second half of a line whose first half is harmless. A quoted separator
 * is not special-cased: splitting on it can only produce *more* segments to
 * check, never fewer, so the error is toward asking.
 */
export function mutatesSharedGitState(command: unknown): boolean {
  if (typeof command !== 'string' || !command.trim()) return false;
  return command
    .split(COMMAND_SEPARATORS)
    .some((segment) => {
      const subcommand = gitSubcommand(segment);
      return subcommand !== null && GIT_STATE_SUBCOMMANDS.has(subcommand);
    });
}

/** The bash-shaped tools whose input carries a command line. */
const SHELL_TOOLS = new Set(['bash', 'powershell']);

/** Reads the command out of a tool call's raw input without trusting its shape. */
function commandOf(rawInput: unknown): unknown {
  if (!rawInput || typeof rawInput !== 'object') return undefined;
  return (rawInput as { command?: unknown }).command;
}

export type SharedCheckoutGate = 'shared' | 'escape';

/**
 * Why this tool call must reach a human even though the project policy would
 * approve it, or `null` when it need not.
 *
 * A project-location run shares its working tree, so every git state change
 * asks. A run that owns a checkout (a managed worktree) is asked about only
 * when the command leaves that checkout - the git state under it is its own.
 */
export function sharedCheckoutGate(
  toolName: unknown,
  rawInput: unknown,
  ownedCheckoutRoot?: string,
): SharedCheckoutGate | null {
  if (typeof toolName !== 'string' || !SHELL_TOOLS.has(toolName.toLowerCase())) return null;
  const command = commandOf(rawInput);
  if (ownedCheckoutRoot === undefined) return mutatesSharedGitState(command) ? 'shared' : null;
  return escapesOwnedCheckout(command, ownedCheckoutRoot) ? 'escape' : null;
}

/** `cd` options that take no directory. */
const CD_OPTIONS = new Set(['-L', '-P', '--']);

/**
 * Resolves one shell word against the directory it runs from, or `undefined`
 * when the result is somewhere the walk cannot compare (HOME via `~`, or a
 * relative path from a directory it failed to resolve). `undefined` reads as
 * outside, so the unreadable asks instead of assuming.
 */
function resolveShellWord(from: string | undefined, word: string): string | undefined {
  if (word.startsWith('~')) return undefined;
  const unquoted = word.replace(/^['"]/, '').replace(/['"]$/, '');
  if (path.isAbsolute(unquoted)) return path.normalize(unquoted);
  return from === undefined ? undefined : path.resolve(from, unquoted);
}

function isInsideRoot(root: string, candidate: string | undefined): boolean {
  return candidate !== undefined && (candidate === root || candidate.startsWith(root + path.sep));
}

type SegmentScan = { escape: boolean; dir: string | undefined };

function scanSegment(tokens: string[], entryDir: string | undefined, ownedRoot: string): SegmentScan {
  let dir = entryDir;
  let index = 0;
  // `VAR=value` prefixes and wrappers sit in front of the real command; `env`
  // can carry a redirecting assignment of its own.
  while (index < tokens.length) {
    const token = tokens[index]!;
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(token);
    if (assignment) {
      if ((assignment[1] === 'GIT_DIR' || assignment[1] === 'GIT_WORK_TREE')
        && !isInsideRoot(ownedRoot, resolveShellWord(dir, assignment[2]))) return { escape: true, dir };
      index += 1;
      continue;
    }
    if (token === 'sudo' || token === 'command' || token === 'env') { index += 1; continue; }
    break;
  }
  const head = tokens[index];
  if (head === undefined) return { escape: false, dir };

  if (head === 'cd') {
    index += 1;
    while (index < tokens.length && CD_OPTIONS.has(tokens[index]!)) index += 1;
    const target = tokens[index];
    // `cd` with no target goes HOME, which the walk cannot resolve.
    dir = target === undefined ? undefined : resolveShellWord(dir, target);
    return { escape: false, dir };
  }

  if (!/(?:^|\/)git(?:\.exe)?$/.test(head)) return { escape: false, dir };

  // Walk the git invocation: `-C` moves it, `--git-dir`/`--work-tree` point
  // its state somewhere else, and the first bare token is the subcommand.
  let gitDir = dir;
  let redirectedOutside = false;
  let subcommand: string | undefined;
  index += 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    const attachedShort = /^-C(.+)$/.exec(token);
    const attachedLong = /^--(?:git-dir|work-tree)=(.+)$/.exec(token);
    if (token === '-C' || token === '--git-dir' || token === '--work-tree') {
      const value = tokens[index + 1];
      index += 2;
      if (value !== undefined) {
        const resolved = resolveShellWord(gitDir, value);
        if (token === '-C') gitDir = resolved;
        else if (!isInsideRoot(ownedRoot, resolved)) redirectedOutside = true;
      }
    } else if (attachedShort) {
      gitDir = resolveShellWord(gitDir, attachedShort[1]);
      index += 1;
    } else if (attachedLong) {
      if (!isInsideRoot(ownedRoot, resolveShellWord(gitDir, attachedLong[1]))) redirectedOutside = true;
      index += 1;
    } else if (GIT_VALUE_FLAGS.has(token)) { index += 2; }
    else if (token.startsWith('-')) { index += 1; }
    else { subcommand = token.toLowerCase(); break; }
  }
  if (subcommand !== undefined && GIT_STATE_SUBCOMMANDS.has(subcommand)
    && (redirectedOutside || !isInsideRoot(ownedRoot, gitDir))) {
    return { escape: true, dir };
  }
  return { escape: false, dir };
}

/**
 * Whether a bash command line rewrites git state outside the checkout this run
 * owns. The walk carries the working directory across `cd` and honors git's
 * own redirects (`-C`, `--git-dir`, `--work-tree`, `GIT_DIR`/`GIT_WORK_TREE`),
 * so `git -C ../.. commit` and `cd <repository> && git push` are caught while
 * an ordinary commit inside the worktree stays exempt.
 */
export function escapesOwnedCheckout(command: unknown, ownedRoot: string): boolean {
  if (typeof command !== 'string' || !command.trim()) return false;
  let dir: string | undefined = ownedRoot;
  for (const segment of command.split(COMMAND_SEPARATORS)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const scan = scanSegment(tokens, dir, ownedRoot);
    if (scan.escape) return true;
    dir = scan.dir;
  }
  return false;
}

/** The transcript line explaining why a card appeared under an auto-approving policy. */
export const GJC_SHARED_CHECKOUT_NOTICE =
  'This session runs in the project checkout, which other sessions share. Git state changes are asked about even when the project policy would approve them.';

/** Same, for a worktree session whose command left its own checkout. */
export const GJC_CHECKOUT_ESCAPE_NOTICE =
  'This git command changes state outside the worktree this session owns. It is asked about even when the project policy would approve it.';
