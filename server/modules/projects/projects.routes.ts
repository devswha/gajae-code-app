import express from 'express';

import { deleteOrArchiveProject, restoreArchivedProject } from '@/modules/projects/services/project-delete.service.js';
import { startCloneProject, type CloneProjectOperation } from '@/modules/projects/services/project-clone.service.js';
import { createProject, promoteProjectOrigin, updateProjectDisplayName } from '@/modules/projects/services/project-management.service.js';
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

router.post('/:projectId/promote', asyncHandler(async (request, response) => {
  const projectId = routeProjectId(request.params.projectId, true);
  if (!projectId) throw new AppError('projectId is required', { code: 'PROJECT_ID_REQUIRED', statusCode: 400 });
  response.json({ success: true, project: promoteProjectOrigin(projectId) });
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
      details: 'Use /api/projects/clone-progress for cloning workflows',
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

router.post('/migrate-legacy-stars', asyncHandler(async (request, response) => {
  const body: { projectIds?: unknown } = request.body;
  const projectIds = Array.isArray(body?.projectIds) ? body.projectIds.map((id) => String(id)) : [];
  response.json({ success: true, updated: applyLegacyStarredProjectIds(projectIds).updated });
}));

router.get('/clone-progress', async (request, response) => {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  const emit = (type: string, data: Record<string, unknown>): void => {
    if (!response.writableEnded) response.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };
  let cloneOperation: CloneProjectOperation | null = null;
  const cancelClone = (): void => cloneOperation?.cancel();
  request.on('close', cancelClone);

  try {
    const query = request.query;
    // Authentication middleware adds this field before the clone route runs.
    const authenticatedRequest = request as AuthenticatedRequest;
    const userId = authenticatedRequest.user?.id;
    if (userId === undefined || userId === null) {
      throw new AppError('Authenticated user is required', { code: 'AUTHENTICATION_REQUIRED', statusCode: 401 });
    }
    cloneOperation = await startCloneProject({
      workspacePath: queryText(query.path),
      githubUrl: queryText(query.githubUrl),
      githubTokenId: queryNumber(query.githubTokenId),
      newGithubToken: queryText(query.newGithubToken) || null,
      userId,
    }, {
      onProgress: (message) => emit('progress', { message }),
      onComplete: ({ project, message }) => emit('complete', { project, message }),
    });
    await cloneOperation.waitForCompletion;
  } catch (error) {
    emit('error', { message: cloneErrorMessage(error) });
  } finally {
    request.off('close', cancelClone);
    if (!response.writableEnded) response.end();
  }
});

router.put('/:projectId/rename', (request, response) => {
  try {
    const body: { displayName?: unknown } = request.body;
    updateProjectDisplayName(routeProjectId(request.params.projectId), body.displayName);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Failed to rename project' });
  }
});

router.post('/:projectId/toggle-star', asyncHandler(async (request, response) => {
  response.json({ success: true, isStarred: toggleProjectStar(routeProjectId(request.params.projectId)).isStarred });
}));

router.post('/:projectId/restore', asyncHandler(async (request, response) => {
  const projectId = routeProjectId(request.params.projectId);
  restoreArchivedProject(projectId);
  response.json(createApiSuccessResponse({ projectId, isArchived: false }));
}));

router.delete('/:projectId', asyncHandler(async (request, response) => {
  await deleteOrArchiveProject(routeProjectId(request.params.projectId), request.query.force === 'true');
  response.json({ success: true });
}));

export default router;
