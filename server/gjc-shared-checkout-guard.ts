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
 * A session in its own managed worktree is exempt: the whole point of the
 * worktree is that its git state is its own.
 *
 * This is a prompt, not a sandbox. The command text is matched, and text can
 * be written to defeat matching; a run that wants to escape can. What it stops
 * is the ordinary case - a capable model doing exactly what it was asked, in
 * the directory it was given, with nobody told. The runtime owns actual
 * containment.
 */

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

/**
 * Whether this tool call must reach a human even though the project policy
 * would approve it.
 *
 * `isolated` is the session's own answer, not a guess: a run in a managed
 * worktree owns its git state and is never gated here.
 */
export function requiresSharedCheckoutApproval(
  toolName: unknown,
  rawInput: unknown,
  isolated: boolean,
): boolean {
  if (isolated) return false;
  if (typeof toolName !== 'string' || !SHELL_TOOLS.has(toolName.toLowerCase())) return false;
  return mutatesSharedGitState(commandOf(rawInput));
}

/** The transcript line explaining why a card appeared under an auto-approving policy. */
export const GJC_SHARED_CHECKOUT_NOTICE =
  'This session runs in the project checkout, which other sessions share. Git state changes are asked about even when the project policy would approve them.';
