import { realpath, stat } from 'node:fs/promises';

import { isManagedWorktreePath } from '@/modules/database/index.js';
import { AppError, normalizeProjectPath, validateWorkspacePath } from '@/shared/utils.js';

/** Resolve aliases before binding a session to its project's grouping/policy. */
export async function resolveSessionProjectPath(input: string): Promise<string> {
  const requested = input.trim();
  if (!requested) throw new AppError('projectPath is required.', { code: 'PROJECT_PATH_REQUIRED', statusCode: 400 });
  let canonical: string;
  try {
    // Resolve before lexical normalization so a symlink followed by `..`
    // keeps its filesystem meaning. Never fall back to an unverified alias.
    canonical = normalizeProjectPath(await realpath(requested));
    if (!(await stat(canonical)).isDirectory()) throw new Error('Not a directory');
  } catch {
    throw new AppError('Project directory is unavailable.', { code: 'INVALID_PROJECT_PATH', statusCode: 400 });
  }
  if (isManagedWorktreePath(requested) || isManagedWorktreePath(canonical)) {
    throw new AppError('Managed worktrees require a bound session.', { code: 'PROJECT_PATH_IS_MANAGED_WORKTREE', statusCode: 400 });
  }
  // A session's project path is the agent's working root, so it passes the
  // same gate project registration does. Without it, `/` (or any tree outside
  // the workspace root) becomes a machine-wide root for the agent's tools.
  const jailed = await validateWorkspacePath(canonical);
  if (!jailed.valid) {
    throw new AppError(jailed.error || 'Invalid project path.', { code: 'INVALID_PROJECT_PATH', statusCode: 400 });
  }
  return canonical;
}
