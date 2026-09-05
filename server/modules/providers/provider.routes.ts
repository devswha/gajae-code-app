import express, { type Request, type Response } from 'express';

import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { providerCommandsService } from '@/modules/providers/services/provider-commands.service.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { providerSkillsService } from '@/modules/providers/services/provider-skills.service.js';
import { sessionConversationsSearchService } from '@/modules/providers/services/session-conversations-search.service.js';
import { exportSessionTranscript } from '@/modules/providers/services/session-export.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { createWorktreeSession, readSessionLocation, resolveSessionCommandWorkspace } from '@/modules/providers/services/session-worktrees.service.js';
import { getHomeDir, getHomeDirSuggestions } from '@/modules/providers/services/home-dirs.service.js';
import type { LLMProvider, ProviderChangeActiveModelInput } from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();
const SESSION_ID = /^[a-zA-Z0-9._-]{1,120}$/;

const invalid = (message: string, code: string): never => {
  throw new AppError(message, { code, statusCode: 400 });
};

const firstPathValue = (raw: unknown, label: string): string => {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return invalid(`${label} path parameter is invalid.`, 'INVALID_PATH_PARAMETER');
};

const providerFrom = (raw: unknown): LLMProvider => {
  const provider = firstPathValue(raw, 'provider').trim().toLowerCase();
  return provider === 'gjc'
    ? provider
    : invalid(`Unsupported provider "${provider}".`, 'UNSUPPORTED_PROVIDER');
};

const sessionFrom = (raw: unknown): string => {
  const sessionId = firstPathValue(raw, 'sessionId').trim();
  return SESSION_ID.test(sessionId) ? sessionId : invalid('Invalid sessionId.', 'INVALID_SESSION_ID');
};

const queryText = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  return text || undefined;
};

const querySessionId = (raw: unknown): string | undefined => raw === undefined
  ? undefined
  : typeof raw === 'string' ? sessionFrom(raw) : invalid('Invalid sessionId.', 'INVALID_SESSION_ID');

const queryFlag = (raw: unknown, name: string): boolean | undefined => {
  if (raw === undefined) return undefined;
  const text = queryText(raw);
  if (!text) return undefined;
  if (text === 'true') return true;
  if (text === 'false') return false;
  return invalid(`${name} must be "true" or "false".`, 'INVALID_QUERY_PARAMETER');
};

const objectBody = (raw: unknown): Record<string, unknown> => (
  raw && typeof raw === 'object'
    ? raw as Record<string, unknown>
    : invalid('Request body must be an object.', 'INVALID_REQUEST_BODY')
);

const renamedSummary = (raw: unknown): string => {
  const body = objectBody(raw);
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (!summary) return invalid('Summary is required.', 'INVALID_SESSION_SUMMARY');
  if (summary.length > 500) return invalid('Summary must not exceed 500 characters.', 'INVALID_SESSION_SUMMARY');
  return summary;
};

const chosenModel = (raw: unknown): ProviderChangeActiveModelInput => {
  const model = queryText(objectBody(raw).model);
  if (!model) return invalid('model is required.', 'MODEL_REQUIRED');
  return { sessionId: '', model };
};

const searchQuery = (raw: unknown): string => {
  const query = queryText(raw) ?? '';
  return query.length >= 2 ? query : invalid('Query must be at least 2 characters', 'INVALID_SEARCH_QUERY');
};

const searchLimit = (raw: unknown): number => {
  const text = queryText(raw);
  if (!text) return 50;
  const value = Number.parseInt(text, 10);
  if (Number.isNaN(value)) return invalid('limit must be a valid integer.', 'INVALID_QUERY_PARAMETER');
  return Math.max(1, Math.min(value, 100));
};

const nonNegativeQueryNumber = (raw: unknown, fallback: number | null): number | null => {
  const text = queryText(raw);
  if (text === undefined) return fallback;
  const value = Number.parseInt(text, 10);
  if (Number.isNaN(value) || value < 0) return invalid('limit must be a non-negative integer.', 'INVALID_QUERY_PARAMETER');
  return value;
};

router.get('/:provider/auth/status', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(await providerAuthService.getProviderAuthStatus(providerFrom(req.params.provider))));
}));

router.get('/:provider/models', asyncHandler(async (req: Request, res: Response) => {
  const provider = providerFrom(req.params.provider);
  const result = await providerModelsService.getProviderModels(provider, { bypassCache: queryFlag(req.query.bypassCache, 'bypassCache') ?? false });
  res.json(createApiSuccessResponse({ provider, models: result.models, cache: result.cache }));
}));

router.get('/:provider/skills', asyncHandler(async (req: Request, res: Response) => {
  const provider = providerFrom(req.params.provider);
  const projectId = queryText(req.query.projectId);
  const sessionId = querySessionId(req.query.sessionId);
  const workspace = sessionId ? await resolveSessionCommandWorkspace(projectId, sessionId) : undefined;
  res.json(createApiSuccessResponse({ provider, skills: await providerSkillsService.listProviderSkills(provider, projectId, workspace) }));
}));

router.get('/:provider/commands', asyncHandler(async (req: Request, res: Response) => {
  providerFrom(req.params.provider);
  const projectId = queryText(req.query.projectId);
  const sessionId = querySessionId(req.query.sessionId);
  const workspace = sessionId ? await resolveSessionCommandWorkspace(projectId, sessionId) : undefined;
  res.json(createApiSuccessResponse({ provider: 'gjc', commands: await providerCommandsService.listProviderCommands(projectId, workspace) }));
}));

router.get('/:provider/sessions/:sessionId/active-model', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(await providerModelsService.getChangedActiveModel(providerFrom(req.params.provider), sessionFrom(req.params.sessionId))));
}));

router.post('/:provider/sessions/:sessionId/active-model', asyncHandler(async (req: Request, res: Response) => {
  const change = chosenModel(req.body);
  res.json(createApiSuccessResponse(await providerModelsService.changeActiveModel(providerFrom(req.params.provider), { ...change, sessionId: sessionFrom(req.params.sessionId) })));
}));

router.get('/capabilities', asyncHandler(async (_req: Request, res: Response) => {
  res.json(createApiSuccessResponse({ providers: providerCapabilitiesService.listAllProviderCapabilities() }));
}));

router.get('/:provider/capabilities', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(providerCapabilitiesService.getProviderCapabilities(providerFrom(req.params.provider))));
}));

router.post('/sessions', asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
  res.status(201).json(createApiSuccessResponse(await sessionsService.createAppSession(providerFrom(body.provider), projectPath)));
}));

router.post('/worktree-sessions', asyncHandler(async (req: Request, res: Response) => {
  const body = objectBody(req.body);
  providerFrom(body.provider);
  const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
  res.status(201).json(createApiSuccessResponse(await createWorktreeSession(projectPath)));
}));

router.get('/sessions/:sessionId/location', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(readSessionLocation(sessionFrom(req.params.sessionId))));
}));

router.get('/sessions/running', asyncHandler(async (_req: Request, res: Response) => {
  res.json(createApiSuccessResponse({ sessions: sessionsService.listRunningSessions() }));
}));

router.get('/sessions/archived', asyncHandler(async (_req: Request, res: Response) => {
  res.json(createApiSuccessResponse({ sessions: sessionsService.listArchivedSessions() }));
}));

router.post('/sessions/archive-idle', asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const activeSessionIds = sessionsService.listRunningSessions()
    .map((session) => session.sessionId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const olderThanDays = typeof body.olderThanDays === 'number' ? body.olderThanDays : Number.NaN;
  const result = sessionsService.archiveSessionsIdleFor(olderThanDays, { dryRun: body.dryRun === true, excludeSessionIds: activeSessionIds });
  res.json(createApiSuccessResponse(result));
}));

router.get('/fs/dir-suggestions', asyncHandler(async (req: Request, res: Response) => {
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
  res.json(createApiSuccessResponse({ home: getHomeDir(), suggestions: await getHomeDirSuggestions(prefix) }));
}));

router.delete('/sessions/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const force = queryFlag(req.query.force, 'force') ?? false;
  const result = await sessionsService.deleteOrArchiveSessionById(sessionFrom(req.params.sessionId), {
    force,
    deletedFromDisk: queryFlag(req.query.deletedFromDisk, 'deletedFromDisk') ?? force,
  });
  res.json(createApiSuccessResponse(result));
}));

router.post('/sessions/:sessionId/restore', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(sessionsService.restoreSessionById(sessionFrom(req.params.sessionId))));
}));

router.post('/sessions/:sessionId/toggle-star', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(sessionsService.toggleSessionStarById(sessionFrom(req.params.sessionId))));
}));

router.put('/sessions/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(sessionsService.renameSessionById(sessionFrom(req.params.sessionId), renamedSummary(req.body))));
}));

router.post('/sessions/:sessionId/regenerate-title', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(await sessionsService.regenerateSessionTitle(sessionFrom(req.params.sessionId))));
}));

router.get('/sessions/:sessionId/export', asyncHandler(async (req: Request, res: Response) => {
  const transcript = await exportSessionTranscript(sessionFrom(req.params.sessionId));
  res.setHeader('Content-Type', transcript.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${transcript.asciiFilename}"; filename*=UTF-8''${encodeURIComponent(transcript.filename)}`);
  res.send(transcript.body);
}));

router.get('/sessions/:sessionId/messages', asyncHandler(async (req: Request, res: Response) => {
  const limit = nonNegativeQueryNumber(req.query.limit, null);
  const offset = nonNegativeQueryNumber(req.query.offset, 0) as number;
  const result = await sessionsService.fetchHistory(sessionFrom(req.params.sessionId), { limit, offset, includeImages: queryFlag(req.query.includeImages, 'includeImages') });
  res.json(createApiSuccessResponse(result));
}));

router.get('/sessions/:sessionId/tool-result', asyncHandler(async (req: Request, res: Response) => {
  const toolIdParam = queryText(req.query.toolId);
  const toolId = typeof toolIdParam === 'string' ? toolIdParam.trim() : '';
  if (!toolId) invalid('toolId is required.', 'INVALID_QUERY_PARAMETER');
  res.json(createApiSuccessResponse(await sessionsService.fetchToolResult(sessionFrom(req.params.sessionId), toolId)));
}));

router.get('/search/sessions', asyncHandler(async (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let disconnected = false;
  const cancellation = new AbortController();
  req.on('close', () => { disconnected = true; cancellation.abort(); });

  try {
    await sessionConversationsSearchService.search({
      query: searchQuery(req.query.q),
      limit: searchLimit(req.query.limit),
      projectId: req.query.projectId === undefined ? undefined
        : queryText(req.query.projectId) ?? invalid('projectId must be a non-empty string.', 'INVALID_QUERY_PARAMETER'),
      signal: cancellation.signal,
      onProgress: ({ projectResult, totalMatches, scannedProjects, totalProjects }) => {
        if (disconnected) return;
        const event = projectResult ? 'result' : 'progress';
        const data = projectResult
          ? { projectResult, totalMatches, scannedProjects, totalProjects }
          : { totalMatches, scannedProjects, totalProjects };
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
    });
    if (!disconnected) res.write('event: done\ndata: {}\n\n');
  } catch (error) {
    console.error('Error searching conversations:', error);
    if (!disconnected) res.write(`event: error\ndata: ${JSON.stringify({ error: 'Search failed' })}\n\n`);
  } finally {
    if (!disconnected) res.end();
  }
}));

export default router;
