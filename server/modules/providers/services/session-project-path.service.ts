import { realpath, stat } from 'node:fs/promises';

import { isManagedWorktreePath } from '@/modules/database/index.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';

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
  return canonical;
}
