import express from 'express';

import { archiveProject, restoreArchivedProject } from '@/modules/projects/services/project-archive.service.js';
import { createCloneProgressStream, readCloneProgress, type CloneProgressEvent } from '@/modules/projects/services/clone-progress-registry.service.js';
import { startCloneProject } from '@/modules/projects/services/project-clone.service.js';
import { createProject, promoteProjectOrigin, updateProjectDisplayName } from '@/modules/projects/services/project-management.service.js';
import { startScratchWorkspace } from '@/modules/projects/services/scratch-workspace.service.js';
import { descendIntoChild, resolveWorkspaceTarget } from '@/modules/projects/services/workspace-target.service.js';
import {
  getProjectPermissions,
  listConfiguredProjectPermissions,
  resetProjectPermissions,
  revokeProjectAlwaysAllow,
  updateProjectPermissionMode,
} from '@/modules/projects/services/project-permissions.service.js';
import { applyLegacyStarredProjectIds, toggleProjectStar } from '@/modules/projects/services/project-star.service.js';
import { getArchivedProjectsWithSessions, getProjectSessionsPage, getProjectsWithSessions } from '@/modules/projects/services/projects-with-sessions-fetch.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();
type AuthenticatedRequest = express.Request & { user?: { id?: number | string } };
function queryText(value: unknown): string {
  if (typeof value === 'string') return value;
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
}

function queryNumber(value: unknown): number | null {
  const text = queryText(value).trim();
  if (!text) return null;
  const number = Number.parseInt(text, 10);
  return Number.isNaN(number) ? null : number;
}

function nonNegativeQueryNumber(value: unknown, field: string, defaultValue: number): number {
  const text = queryText(value).trim();
  if (!text) return defaultValue;
  const number = Number.parseInt(text, 10);
  if (Number.isNaN(number) || number < 0) {
    throw new AppError(`${field} must be a non-negative integer`, { code: 'INVALID_QUERY_PARAMETER', statusCode: 400 });
  }
  return number;
}

function routeProjectId(value: unknown, trim = false): string {
  const id = typeof value === 'string' ? value : '';
  return trim ? id.trim() : id;
}

function cloneErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return error instanceof Error && error.message ? error.message : 'Failed to clone repository';
}

function bodyText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isHttpsCloneUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

router.get('/', asyncHandler(async (request, response) => {
  const skipSynchronization = ['skipSynchronization', 'skipSync'].some((key) => queryText(request.query[key]).trim() === '1');
  const sessionsLimit = queryNumber(request.query.sessionsLimit) ?? undefined;
  const sessionsOffset = queryNumber(request.query.sessionsOffset) ?? undefined;
  response.json(await getProjectsWithSessions({ skipSynchronization, sessionsLimit, sessionsOffset }));
}));

router.get('/archived', asyncHandler(async (request, response) => {
  const sessionsLimit = queryNumber(request.query.sessionsLimit) ?? undefined;
  const sessionsOffset = queryNumber(request.query.sessionsOffset) ?? undefined;
  response.json(createApiSuccessResponse({
    projects: await getArchivedProjectsWithSessions({ sessionsLimit, sessionsOffset }),
  }));
}));

// Every project whose permission policy deviates from the default; registered
// before the `/:projectId/...` routes so the literal segment is never read as an id.
router.get('/permissions', asyncHandler(async (_request, response) => {
  response.json(createApiSuccessResponse({ projects: listConfiguredProjectPermissions() }));
}));

router.get('/:projectId/permissions', asyncHandler(async (request, response) => {
  response.json(createApiSuccessResponse(getProjectPermissions(routeProjectId(request.params.projectId, true))));
}));

router.put('/:projectId/permissions', asyncHandler(async (request, response) => {
  const body: Record<string, unknown> = request.body ?? {};
  response.json(createApiSuccessResponse(updateProjectPermissionMode(routeProjectId(request.params.projectId, true), {
    mode: body.mode,
    acknowledgeBypass: body.acknowledgeBypass,
  })));
}));

router.delete('/:projectId/permissions/allow/:toolName', asyncHandler(async (request, response) => {
  response.json(createApiSuccessResponse(revokeProjectAlwaysAllow(routeProjectId(request.params.projectId, true), request.params.toolName)));
}));

router.delete('/:projectId/permissions', asyncHandler(async (request, response) => {
  response.json(createApiSuccessResponse(resetProjectPermissions(routeProjectId(request.params.projectId, true))));
}));

router.post('/:projectId/promote', asyncHandler(async (request, response) => {
  const projectId = routeProjectId(request.params.projectId, true);
  if (!projectId) throw new AppError('projectId is required', { code: 'PROJECT_ID_REQUIRED', statusCode: 400 });
  response.json({ success: true, project: promoteProjectOrigin(projectId) });
}));

router.get('/:projectId/resolve-target', asyncHandler(async (request, response) => {
  const projectId = routeProjectId(request.params.projectId, true);
  const result = await resolveWorkspaceTarget(projectId, queryText(request.query.text));
  response.json(createApiSuccessResponse(result));
}));

router.post('/:projectId/descend', asyncHandler(async (request, response) => {
  const projectId = routeProjectId(request.params.projectId, true);
  const body: { path?: unknown } = request.body ?? {};
  const childPath = typeof body.path === 'string' ? body.path : '';
  if (!childPath) throw new AppError('path is required', { code: 'NOT_WORKSPACE_CHILD', statusCode: 400 });
  const { created, project } = await descendIntoChild(projectId, childPath);
  response.status(created ? 201 : 200).json(createApiSuccessResponse(project));
}));

router.get('/:projectId/sessions', asyncHandler(async (request, response) => {
  const sessions = await getProjectSessionsPage(routeProjectId(request.params.projectId), {
    limit: nonNegativeQueryNumber(request.query.limit, 'limit', 20),
    offset: nonNegativeQueryNumber(request.query.offset, 'offset', 0),
  });
  response.json(sessions);
}));

router.post('/create-project', asyncHandler(async (request, response) => {
  const input: Record<string, unknown> = request.body;
  if (input.workspaceType !== undefined) {
    throw new AppError('workspaceType is no longer supported. Use the single create-project flow.', { code: 'LEGACY_WORKSPACE_TYPE_UNSUPPORTED', statusCode: 400 });
  }
  if (input.githubUrl || input.githubTokenId || input.newGithubToken) {
    throw new AppError('Repository cloning is not supported on create-project', {
      code: 'CLONE_NOT_SUPPORTED_ON_CREATE_PROJECT',
      statusCode: 400,
      details: 'Use POST /api/projects/clone for cloning workflows',
    });
  }

  const created = await createProject({
    projectPath: typeof input.path === 'string' ? input.path : '',
    customName: typeof input.customName === 'string' ? input.customName : null,
  });
  response.json({
    success: true,
    project: created.project,
    message: created.outcome === 'reactivated_archived' ? 'Archived project path reused successfully' : 'Project created successfully',
  });
}));

// One click from an empty workspace to a conversation: creates and registers
// `<workspace root>/gajae-scratch`. Idempotent - a second call returns the same project.
router.post('/scratch', asyncHandler(async (_request, response) => {
  response.json(createApiSuccessResponse(await startScratchWorkspace()));
}));

router.post('/migrate-legacy-stars', asyncHandler(async (request, response) => {
  const body: { projectIds?: unknown } = request.body;
  const projectIds = Array.isArray(body?.projectIds) ? body.projectIds.map((id) => String(id)) : [];
  response.json({ success: true, updated: applyLegacyStarredProjectIds(projectIds).updated });
}));

/**
 * Cloning is a state change, so it is a POST and nothing else.
 *
 * It used to be the GET that streamed progress. Desktop auth cookies are
 * SameSite=Lax, so a cross-site top-level navigation to that URL carried them
 * and started a clone of an attacker-chosen repository into an
 * attacker-chosen directory, with any supplied token on the process list.
 */
router.post('/clone', asyncHandler(async (request, response) => {
  const body: { path?: unknown; githubUrl?: unknown; githubTokenId?: unknown; newGithubToken?: unknown } = request.body ?? {};
  // Authentication middleware adds this field before the clone route runs.
  const userId = (request as AuthenticatedRequest).user?.id;
  if (userId === undefined || userId === null) {
    throw new AppError('Authenticated user is required', { code: 'AUTHENTICATION_REQUIRED', statusCode: 401 });
  }
  const githubUrl = bodyText(body.githubUrl).trim();
  // Clone URLs reach `git`, which speaks file:, ssh:, ext: and more. Only the
  // transport this feature is for is accepted; `file:` in particular would make
  // any local directory a project the agent then works in.
  if (!isHttpsCloneUrl(githubUrl)) {
    throw new AppError('githubUrl must be an https URL', { code: 'INVALID_GITHUB_URL', statusCode: 400 });
  }
  const stream = createCloneProgressStream();
  const operation = await startCloneProject({
    workspacePath: bodyText(body.path),
    githubUrl,
    githubTokenId: typeof body.githubTokenId === 'number' ? body.githubTokenId : queryNumber(body.githubTokenId),
    newGithubToken: bodyText(body.newGithubToken) || null,
    userId,
  }, {
    onProgress: (message) => stream.publish({ type: 'progress', message }),
    onComplete: ({ project, message }) => stream.publish({ type: 'complete', project, message }),
  });
  // The clone owns its own lifetime from here; the reader only observes it.
  void operation.waitForCompletion
    .catch((error: unknown) => { stream.publish({ type: 'error', message: cloneErrorMessage(error) }); })
    .finally(() => stream.finish());
  response.status(202).json(createApiSuccessResponse({ cloneId: stream.cloneId }));
}));

/** Read-only: follows a clone that `POST /clone` already started. */
router.get('/clone-progress', asyncHandler(async (request, response) => {
  const cloneId = queryText(request.query.cloneId).trim();
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  const emit = (event: CloneProgressEvent): void => {
    if (!response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  let stopWaiting = (): void => {};
  const streamEnded = new Promise<void>((resolve) => { stopWaiting = resolve; });
  const reader = cloneId ? readCloneProgress(cloneId, { onEvent: emit, onFinished: () => stopWaiting() }) : null;
  if (!reader) {
    emit({ type: 'error', message: 'No clone is running for that id.' });
    response.end();
    return;
  }
  // A finished clone replayed everything it had; nothing more will arrive.
  if (!reader.finished) {
    request.on('close', () => stopWaiting());
    await streamEnded;
  }
  reader.unsubscribe();
  if (!response.writableEnded) response.end();
}));

router.put('/:projectId/rename', asyncHandler((request, response) => {
  try {
    const body: { displayName?: unknown } = request.body;
    updateProjectDisplayName(routeProjectId(request.params.projectId), body.displayName);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Failed to rename project' });
  }
}));

router.post('/:projectId/toggle-star', asyncHandler(async (request, response) => {
  response.json({ success: true, isStarred: toggleProjectStar(routeProjectId(request.params.projectId)).isStarred });
}));

router.post('/:projectId/restore', asyncHandler(async (request, response) => {
  const projectId = routeProjectId(request.params.projectId);
  restoreArchivedProject(projectId);
  response.json(createApiSuccessResponse({ projectId, isArchived: false }));
}));

router.post('/:projectId/archive', asyncHandler(async (request, response) => {
  const projectId = routeProjectId(request.params.projectId);
  archiveProject(projectId);
  response.json(createApiSuccessResponse({ projectId, isArchived: true }));
}));

export default router;
