import { execFile as execFileCallback } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { projectsDb, sessionsDb, sessionWorktreesDb } from '../modules/database/index.js';
import type { SessionWorktreeRow } from '../modules/database/repositories/session-worktrees.db.js';
import { AppError } from '../shared/utils.js';

import { GjcGitClient } from './gjc-git-client.js';

const execFile = promisify(execFileCallback);
const unavailable = () => new AppError('Session worktree is unavailable.', { code: 'SESSION_WORKTREE_UNAVAILABLE', statusCode: 409 });

export async function validateSessionRepository(root: string): Promise<void> {
  const project = projectsDb.getProjectPath(root);
  if (!project || project.isArchived) throw new AppError('An active registered project is required.', { code: 'PROJECT_NOT_FOUND', statusCode: 404 });
  try {
    if (await realpath(root) !== root) throw unavailable();
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const { stdout } = await execFile('git', ['rev-parse', '--show-toplevel'], { cwd: root, env, timeout: 5000, maxBuffer: 64 * 1024 });
    if (await realpath(stdout.trim()) !== root) throw unavailable();
    await execFile('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: root, env, timeout: 5000, maxBuffer: 64 * 1024 });
  } catch {
    throw new AppError('Choose a registered Git repository root with a commit for a worktree session.', { code: 'SESSION_WORKTREE_REPOSITORY_REQUIRED', statusCode: 400 });
  }
}

export async function validateSessionWorktree(row: SessionWorktreeRow, preparedPath = row.worktree_path): Promise<string> {
  await validateSessionRepository(row.repository_root);
  const expected = path.join(row.repository_root, '.gjc-worktrees', row.job_id);
  if (!preparedPath || preparedPath !== expected) throw unavailable();
  const git = new GjcGitClient({ workdir: row.repository_root });
  try {
    if (await realpath(preparedPath) !== expected) throw unavailable();
    await git.status({ jobId: row.job_id, branch: `job/${row.job_id}`, path: preparedPath });
    return preparedPath;
  } catch {
    throw unavailable();
  } finally {
    git.close();
  }
}

export function readSessionLocation(sessionId: string) {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session?.project_path) throw new AppError('Session was not found.', { code: 'SESSION_NOT_FOUND', statusCode: 404 });
  const binding = sessionWorktreesDb.get(sessionId);
  if (binding && binding.repository_root !== session.project_path) throw unavailable();
  return {
    mode: binding ? 'worktree' as const : 'project' as const,
    projectPath: session.project_path,
    cwd: binding ? binding.worktree_path : session.project_path,
    jobId: binding?.job_id ?? null,
  };
}

/** Directory-sensitive REST reads use session identity, never a browser cwd. */
export async function resolveSessionWorkspacePath(projectId: string, sessionId?: unknown): Promise<string> {
  const project = projectsDb.getProjectById(projectId);
  if (!project) throw new AppError('Project was not found.', { code: 'PROJECT_NOT_FOUND', statusCode: 404 });
  if (sessionId === undefined) return project.project_path;
  if (typeof sessionId !== 'string' || !sessionId) throw unavailable();
  const session = sessionsDb.getSessionById(sessionId);
  if (!session || session.project_path !== project.project_path) throw new AppError('Session does not belong to this project.', { code: 'SESSION_PROJECT_MISMATCH', statusCode: 403 });
  const binding = sessionWorktreesDb.get(sessionId);
  if (!binding) return project.project_path;
  if (binding.repository_root !== project.project_path) throw unavailable();
  return validateSessionWorktree(binding);
}
