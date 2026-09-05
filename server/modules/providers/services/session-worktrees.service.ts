import { randomUUID } from 'node:crypto';

import { getConnection, sessionsDb, sessionWorktreesDb } from '@/modules/database/index.js';
import { resolveSessionProjectPath } from '@/modules/providers/services/session-project-path.service.js';
import { AppError } from '@/shared/utils.js';

import type { SessionLocation } from '../../../../shared/session-worktree-protocol.js';

type Services = { validateRepository(root: string): Promise<void>; readLocation(sessionId: string): SessionLocation; resolveWorkspace(projectId: string, sessionId: string): Promise<string> };
let services: Services | undefined;
export function configureSessionWorktrees(value: Services): void { services = value; }
function requireServices(): Services {
  if (!services) throw new AppError('Session worktrees are unavailable.', { code: 'SESSION_WORKTREES_UNAVAILABLE', statusCode: 503 });
  return services;
}
export function readSessionLocation(sessionId: string): SessionLocation { return requireServices().readLocation(sessionId); }
/** Transcript reads stay available even when a checkout has been removed. */
export function sessionTranscriptWorkspace(sessionId: string, projectPath: string): string {
  const binding = sessionWorktreesDb.get(sessionId);
  if (!binding) return projectPath;
  if (binding.repository_root !== projectPath || !binding.worktree_path) throw new AppError('Session execution directory is unavailable.', { code: 'SESSION_WORKTREE_UNAVAILABLE', statusCode: 409 });
  return binding.worktree_path;
}
export function resolveSessionCommandWorkspace(projectId: string | undefined, sessionId: string): Promise<string> {
  if (!projectId) throw new AppError('projectId is required for a session workspace.', { code: 'PROJECT_ID_REQUIRED', statusCode: 400 });
  return requireServices().resolveWorkspace(projectId, sessionId);
}

export async function createWorktreeSession(projectPath: string) {
  const canonical = await resolveSessionProjectPath(projectPath);
  await requireServices().validateRepository(canonical);
  const sessionId = randomUUID();
  const jobId = `job-session-${sessionId}`;
  getConnection().transaction(() => {
    sessionsDb.createAppSession(sessionId, 'gjc', canonical);
    sessionWorktreesDb.create(sessionId, jobId, canonical);
  })();
  return { sessionId, provider: 'gjc' as const, projectPath: canonical, executionMode: 'worktree' as const };
}
