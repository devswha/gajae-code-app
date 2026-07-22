import os from 'node:os';
import path from 'node:path';
import { readdir, realpath } from 'node:fs/promises';

/**
 * Home-relative directory suggestions for the spawn form's cwd input.
 * The tower's /spawn contract takes a HOME-relative path ("workspace/my-proj"),
 * so suggestions are computed under $HOME only — read-only readdir, hidden dirs
 * excluded unless the fragment itself starts with '.'.
 *
 * Containment is REAL-PATH based, not lexical: the listed directory's realpath
 * must sit under one of the allowed roots. Allowed roots are realpath($HOME)
 * plus the realpaths of $HOME's DIRECT children (the self-host decoy-HOME
 * pattern symlinks each top-level entry to the real home, and those must keep
 * working) — but a symlink planted deeper (e.g. ~/workspace/evil → /etc) fails
 * containment and returns [].
 */

export const MAX_DIR_SUGGESTIONS = 20;

/** Absolute HOME path — clients join it with home-relative picks. */
export function getHomeDir(): string {
  return os.homedir();
}

/** Splits a partial input into its listed directory and the fragment being typed. */
export function splitPrefix(prefix: string): { dirPart: string; fragment: string } {
  const slash = prefix.lastIndexOf('/');
  if (slash < 0) {
    return { dirPart: '', fragment: prefix };
  }
  return { dirPart: prefix.slice(0, slash), fragment: prefix.slice(slash + 1) };
}

/** Pure filter: directory entry names → sorted home-relative suggestions. */
export function filterDirSuggestions(args: {
  dirPart: string;
  fragment: string;
  entryNames: string[];
}): string[] {
  const showHidden = args.fragment.startsWith('.');
  return args.entryNames
    .filter((name) => (showHidden || !name.startsWith('.')) && name.startsWith(args.fragment))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_DIR_SUGGESTIONS)
    .map((name) => (args.dirPart ? `${args.dirPart}/${name}` : name));
}

async function safeRealpath(target: string): Promise<string | null> {
  try {
    return await realpath(target);
  } catch {
    return null;
  }
}

/** realpath($HOME) ∪ realpaths of $HOME's direct child dirs (decoy-HOME symlinks). */
async function resolveAllowedRoots(home: string): Promise<string[]> {
  const roots: string[] = [];
  const homeReal = await safeRealpath(home);
  if (homeReal) {
    roots.push(homeReal);
  }
  try {
    const entries = await readdir(home, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isSymbolicLink() && !entry.isDirectory()) {
        continue;
      }
      const childReal = await safeRealpath(path.join(home, entry.name));
      if (childReal) {
        roots.push(childReal);
      }
    }
  } catch {
    // home unreadable → roots stay minimal; containment below fails closed
  }
  return roots;
}

function isUnderAnyRoot(target: string, roots: string[]): boolean {
  return roots.some((root) => target === root || target.startsWith(`${root}${path.sep}`));
}

/**
 * Lists directory suggestions for a home-relative prefix. [] on any failure
 * (missing dir, permission, traversal or symlink escape).
 * `homeDir` is parameterized for tests; production uses $HOME.
 */
export async function getHomeDirSuggestions(prefix: string, homeDir: string = os.homedir()): Promise<string[]> {
  if (prefix.includes('\0') || prefix.startsWith('/') || prefix.length > 512) {
    return [];
  }
  const { dirPart, fragment } = splitPrefix(prefix);
  const target = path.resolve(homeDir, dirPart);
  // Lexical guard first (cheap reject of ../ traversal)…
  if (target !== homeDir && !target.startsWith(`${homeDir}${path.sep}`)) {
    return [];
  }
  // …then real-path containment so symlinks cannot escape the allowed roots.
  const [targetReal, allowedRoots] = await Promise.all([safeRealpath(target), resolveAllowedRoots(homeDir)]);
  if (!targetReal || allowedRoots.length === 0 || !isUnderAnyRoot(targetReal, allowedRoots)) {
    return [];
  }
  try {
    const entries = await readdir(targetReal, { withFileTypes: true });
    return filterDirSuggestions({
      dirPart,
      fragment,
      entryNames: entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name),
    });
  } catch {
    return [];
  }
}
