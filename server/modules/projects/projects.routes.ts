import express from 'express';

import { deleteOrArchiveProject, restoreArchivedProject } from '@/modules/projects/services/project-delete.service.js';
import { startCloneProject } from '@/modules/projects/services/project-clone.service.js';
import { createProject, promoteProjectOrigin, updateProjectDisplayName } from '@/modules/projects/services/project-management.service.js';
import { applyLegacyStarredProjectIds, toggleProjectStar } from '@/modules/projects/services/project-star.service.js';
import { getArchivedProjectsWithSessions, getProjectSessionsPage, getProjectsWithSessions } from '@/modules/projects/services/projects-with-sessions-fetch.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();
type AuthenticatedUser = { id?: number | string };

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
}

function optionalNumber(value: unknown): number | null {
  const candidate = text(value).trim();
  if (!candidate) return null;
  const parsed = Number.parseInt(candidate, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function pageNumber(value: unknown, field: string, otherwise: number): number {
  const candidate = text(value).trim();
  if (!candidate) return otherwise;
  const parsed = Number.parseInt(candidate, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new AppError(`${field} must be a non-negative integer`, { code: 'INVALID_QUERY_PARAMETER', statusCode: 400 });
  }
  return parsed;
}

function projectId(value: unknown, trim = false): string {
  const valueAsText = typeof value === 'string' ? value : '';
  return trim ? valueAsText.trim() : valueAsText;
}

function cloneError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return error instanceof Error && error.message ? error.message : 'Failed to clone repository';
}

router.get('/', asyncHandler(async (req, res) => {
  const skipSynchronization = ['skipSynchronization', 'skipSync'].some((key) => text(req.query[key]).trim() === '1');
  const sessionsLimit = optionalNumber(req.query.sessionsLimit) ?? undefined;
  const sessionsOffset = optionalNumber(req.query.sessionsOffset) ?? undefined;
  res.json(await getProjectsWithSessions({ skipSynchronization, sessionsLimit, sessionsOffset }));
}));

router.get('/archived', asyncHandler(async (req, res) => {
  const sessionsLimit = optionalNumber(req.query.sessionsLimit) ?? undefined;
  const sessionsOffset = optionalNumber(req.query.sessionsOffset) ?? undefined;
  res.json(createApiSuccessResponse({ projects: await getArchivedProjectsWithSessions({ sessionsLimit, sessionsOffset }) }));
}));

router.post('/:projectId/promote', asyncHandler(async (req, res) => {
  const id = projectId(req.params.projectId, true);
  if (!id) throw new AppError('projectId is required', { code: 'PROJECT_ID_REQUIRED', statusCode: 400 });
  res.json({ success: true, project: promoteProjectOrigin(id) });
}));

router.get('/:projectId/sessions', asyncHandler(async (req, res) => {
  res.json(await getProjectSessionsPage(projectId(req.params.projectId), {
    limit: pageNumber(req.query.limit, 'limit', 20),
    offset: pageNumber(req.query.offset, 'offset', 0),
  }));
}));

router.post('/create-project', asyncHandler(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (body.workspaceType !== undefined) {
    throw new AppError('workspaceType is no longer supported. Use the single create-project flow.', { code: 'LEGACY_WORKSPACE_TYPE_UNSUPPORTED', statusCode: 400 });
  }
  if (body.githubUrl || body.githubTokenId || body.newGithubToken) {
    throw new AppError('Repository cloning is not supported on create-project', {
      code: 'CLONE_NOT_SUPPORTED_ON_CREATE_PROJECT',
      statusCode: 400,
      details: 'Use /api/projects/clone-progress for cloning workflows',
    });
  }
  const created = await createProject({
    projectPath: typeof body.path === 'string' ? body.path : '',
    customName: typeof body.customName === 'string' ? body.customName : null,
  });
  res.json({
    success: true,
    project: created.project,
    message: created.outcome === 'reactivated_archived' ? 'Archived project path reused successfully' : 'Project created successfully',
  });
}));

router.post('/migrate-legacy-stars', asyncHandler(async (req, res) => {
  const ids = (req.body as { projectIds?: unknown })?.projectIds;
  const projectIds = Array.isArray(ids) ? ids.map((id) => String(id)) : [];
  res.json({ success: true, updated: applyLegacyStarredProjectIds(projectIds).updated });
}));

router.get('/clone-progress', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emit = (type: string, data: Record<string, unknown>): void => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };
  let operation: Awaited<ReturnType<typeof startCloneProject>> | null = null;
  const cancel = (): void => operation?.cancel();
  req.on('close', cancel);
  try {
    const query = req.query as Record<string, unknown>;
    const userId = (req as typeof req & { user?: AuthenticatedUser }).user?.id;
    if (userId === undefined || userId === null) {
      throw new AppError('Authenticated user is required', { code: 'AUTHENTICATION_REQUIRED', statusCode: 401 });
    }
    operation = await startCloneProject({
      workspacePath: text(query.path),
      githubUrl: text(query.githubUrl),
      githubTokenId: optionalNumber(query.githubTokenId),
      newGithubToken: text(query.newGithubToken) || null,
      userId,
    }, {
      onProgress: (message) => emit('progress', { message }),
      onComplete: ({ project, message }) => emit('complete', { project, message }),
    });
    await operation.waitForCompletion;
  } catch (error) {
    emit('error', { message: cloneError(error) });
  } finally {
    req.off('close', cancel);
    if (!res.writableEnded) res.end();
  }
});

router.put('/:projectId/rename', (req, res) => {
  try {
    updateProjectDisplayName(projectId(req.params.projectId), (req.body as { displayName?: unknown }).displayName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to rename project' });
  }
});

router.post('/:projectId/toggle-star', asyncHandler(async (req, res) => {
  res.json({ success: true, isStarred: toggleProjectStar(projectId(req.params.projectId)).isStarred });
}));

router.post('/:projectId/restore', asyncHandler(async (req, res) => {
  const id = projectId(req.params.projectId);
  restoreArchivedProject(id);
  res.json(createApiSuccessResponse({ projectId: id, isArchived: false }));
}));

router.delete('/:projectId', asyncHandler(async (req, res) => {
  await deleteOrArchiveProject(projectId(req.params.projectId), req.query.force === 'true');
  res.json({ success: true });
}));

export default router;
