import fs from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionSynchronizerService } from '@/modules/providers/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type SessionSummary = { id: string; provider: string; summary: string; isStarred: boolean; messageCount: number; lastActivity: string };
type SessionRepositoryRow = { provider: string; session_id: string; custom_name?: string | null; isStarred: number; updated_at?: string | null; created_at?: string | null };
type InitialProjectSessionRow = SessionRepositoryRow & { project_path: string | null; total: number };
export type ProjectListItem = { projectId: string; path: string; displayName: string; fullPath: string; origin: 'legacy' | 'explicit' | 'auto'; isStarred: boolean; sessions: SessionSummary[]; sessionMeta: { hasMore: boolean; total: number } };
export type ArchivedProjectListItem = ProjectListItem & { isArchived: true };
type ProgressUpdate = { phase: 'loading' | 'complete'; current: number; total: number; currentProject?: string };
type GetProjectsWithSessionsOptions = { skipSynchronization?: boolean; sessionsLimit?: number; sessionsOffset?: number };
type SessionPaginationOptions = { limit?: number; offset?: number };
type ProjectSessionsPageResult = { sessions: SessionSummary[]; total: number; hasMore: boolean };
export type ProjectSessionsPageApiView = { projectId: string; sessions: SessionSummary[]; sessionMeta: { hasMore: boolean; total: number } };

const defaultPageSize = 20;
const maxPageSize = 200;
const initialPageSize = 5;

export async function generateDisplayName(projectName: string, actualProjectDir: string | null = null): Promise<string> {
  const projectDirectory = actualProjectDir || projectName.replace(/-/g, '/');
  // Project manifests are advisory labels, so a missing or invalid one is non-fatal.
  const manifestName = await fs.readFile(path.join(projectDirectory, 'package.json'), 'utf8')
    .then((packageFile) => (JSON.parse(packageFile) as { name?: string }).name)
    .catch(() => undefined);
  if (manifestName) return manifestName;
  if (!projectDirectory.startsWith('/')) return projectDirectory;
  return projectDirectory.split('/').filter(Boolean).at(-1) || projectDirectory;
}

function pagination(options: SessionPaginationOptions = {}): { limit: number; offset: number } {
  const requestedLimit = Number.isFinite(options.limit) ? Math.floor(Number(options.limit)) : defaultPageSize;
  const requestedOffset = Number.isFinite(options.offset) ? Math.floor(Number(options.offset)) : 0;
  const bounded = {
    limit: Math.min(Math.max(1, requestedLimit), maxPageSize),
    offset: Math.max(0, requestedOffset),
  };
  return bounded;
}

function sessionSummary(session: SessionRepositoryRow): SessionSummary {
  const summary: SessionSummary = {
    id: session.session_id,
    provider: session.provider,
    summary: session.custom_name || '',
    isStarred: Boolean(session.isStarred),
    messageCount: 0, lastActivity: session.updated_at ?? session.created_at ?? new Date().toISOString(),
  };
  return summary;
}

function sessionsPage(projectPath: string, includeArchived: boolean, options: SessionPaginationOptions = {}): ProjectSessionsPageResult {
  const { limit, offset } = pagination(options);
  const sessions = includeArchived
    ? sessionsDb.getSessionsByProjectPathIncludingArchivedPage(projectPath, limit, offset)
    : sessionsDb.getSessionsByProjectPathPage(projectPath, limit, offset);
  const total = includeArchived
    ? sessionsDb.countSessionsByProjectPathIncludingArchived(projectPath)
    : sessionsDb.countSessionsByProjectPath(projectPath);
  const page: ProjectSessionsPageResult = {
    sessions: (sessions as SessionRepositoryRow[]).map(sessionSummary),
    total, hasMore: offset + sessions.length < total,
  };
  return page;
}

function publishProgress(progress: ProgressUpdate): void {
  const serializedProgress = JSON.stringify({ kind: 'loading_progress', ...progress });
  connectedClients.forEach((peer: RealtimeClientConnection) => {
    if (peer.readyState === WS_OPEN_STATE) peer.send(serializedProgress);
  });
}

function initialSessions(limit: number): Map<string, ProjectSessionsPageResult> {
  const pages = new Map<string, ProjectSessionsPageResult>();
  const rows = sessionsDb.getInitialSessionPagesByProject(limit) as InitialProjectSessionRow[];
  for (const row of rows) {
    const rowPath = row.project_path;
    if (!rowPath) continue;

    const page = pages.get(rowPath);
    if (page) {
      page.sessions.push(sessionSummary(row));
      continue;
    }
    pages.set(rowPath, {
      sessions: [sessionSummary(row)],
      total: row.total,
      hasMore: row.total > limit,
    });
  }
  return pages;
}

function emptyPage(): ProjectSessionsPageResult {
  return { sessions: [], total: 0, hasMore: false };
}

function configuredProjectName(customName: string | null | undefined): string | null {
  return customName && customName.trim().length > 0 ? customName : null;
}

export async function getProjectsWithSessions(options: GetProjectsWithSessionsOptions = {}): Promise<ProjectListItem[]> {
  if (!options.skipSynchronization) await sessionSynchronizerService.synchronizeSessions();

  const projects = projectsDb.getProjectPaths() as Array<{ project_id: string; project_path: string; custom_project_name?: string | null; origin?: 'legacy' | 'explicit' | 'auto' | null; isStarred?: number }>;
  const sessionLimit = Math.min(Math.max(1, options.sessionsLimit ?? initialPageSize), maxPageSize);
  const initialPages = initialSessions(sessionLimit);
  const result: ProjectListItem[] = [];

  for (const [index, project] of projects.entries()) {
    const projectPath = project.project_path;
    publishProgress({ phase: 'loading', current: index + 1, total: projects.length, currentProject: projectPath });

    const customName = configuredProjectName(project.custom_project_name);
    const displayName = customName ?? (options.skipSynchronization
      ? path.basename(projectPath) || projectPath
      : await generateDisplayName(path.basename(projectPath) || projectPath, projectPath));
    const sessions = options.sessionsOffset && options.sessionsOffset > 0
      ? sessionsPage(projectPath, false, { limit: sessionLimit, offset: options.sessionsOffset })
      : initialPages.get(projectPath) ?? emptyPage();
    result.push({
      projectId: project.project_id,
      path: projectPath,
      displayName,
      fullPath: projectPath,
      isStarred: Boolean(project.isStarred),
      origin: project.origin ?? 'legacy',
      sessions: sessions.sessions,
      sessionMeta: { hasMore: sessions.hasMore, total: sessions.total },
    });
  }

  publishProgress({ phase: 'complete', current: projects.length, total: projects.length });
  return result;
}

export async function getArchivedProjectsWithSessions(options: Pick<GetProjectsWithSessionsOptions, 'skipSynchronization' | 'sessionsLimit' | 'sessionsOffset'> = {}): Promise<ArchivedProjectListItem[]> {
  if (!options.skipSynchronization) await sessionSynchronizerService.synchronizeSessions();

  const projects = projectsDb.getArchivedProjectPaths() as Array<{ project_id: string; project_path: string; custom_project_name?: string | null; origin?: 'legacy' | 'explicit' | 'auto' | null; isStarred?: number }>;
  const result: ArchivedProjectListItem[] = [];
  for (const project of projects) {
    const projectPath = project.project_path;
    const customName = configuredProjectName(project.custom_project_name);
    const displayName = customName ?? await generateDisplayName(path.basename(projectPath) || projectPath, projectPath);
    const sessions = sessionsPage(projectPath, true, { limit: options.sessionsLimit, offset: options.sessionsOffset });
    const archivedItem: ArchivedProjectListItem = {
      projectId: project.project_id,
      path: projectPath, fullPath: projectPath, displayName,
      isStarred: Boolean(project.isStarred),
      origin: project.origin ?? 'legacy',
      isArchived: true, sessions: sessions.sessions,
      sessionMeta: { hasMore: sessions.hasMore, total: sessions.total },
    };
    result.push(archivedItem);
  }
  return result;
}

export async function getProjectSessionsPage(projectId: string, options: SessionPaginationOptions = {}): Promise<ProjectSessionsPageApiView> {
  const project = projectsDb.getProjectById(projectId);
  if (!project) throw new AppError(`Project "${projectId}" was not found.`, { code: 'PROJECT_NOT_FOUND', statusCode: 404 });

  const sessions = sessionsPage(project.project_path, false, options);
  const view: ProjectSessionsPageApiView = {
    projectId: project.project_id,
    sessions: sessions.sessions,
    sessionMeta: { hasMore: sessions.hasMore, total: sessions.total },
  };
  return view;
}
