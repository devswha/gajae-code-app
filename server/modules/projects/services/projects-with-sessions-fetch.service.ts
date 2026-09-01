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
  const candidate = actualProjectDir || projectName.replace(/-/g, '/');
  try {
    const data = await fs.readFile(path.join(candidate, 'package.json'), 'utf8');
    const packageName = (JSON.parse(data) as { name?: string }).name;
    if (packageName) return packageName;
  } catch {
    // Filesystem metadata is optional for a project label.
  }
  if (!candidate.startsWith('/')) return candidate;
  return candidate.split('/').filter(Boolean).at(-1) || candidate;
}

function pageOptions(options: SessionPaginationOptions = {}): { limit: number; offset: number } {
  const limit = Number.isFinite(options.limit) ? Math.floor(Number(options.limit)) : defaultPageSize;
  const offset = Number.isFinite(options.offset) ? Math.floor(Number(options.offset)) : 0;
  return { limit: Math.min(Math.max(1, limit), maxPageSize), offset: Math.max(0, offset) };
}

function summary(row: SessionRepositoryRow): SessionSummary {
  return {
    id: row.session_id,
    provider: row.provider,
    summary: row.custom_name || '',
    isStarred: Boolean(row.isStarred),
    messageCount: 0,
    lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
  };
}

function sessionPage(projectPath: string, includeArchived: boolean, options: SessionPaginationOptions = {}): ProjectSessionsPageResult {
  const { limit, offset } = pageOptions(options);
  const rows = includeArchived
    ? sessionsDb.getSessionsByProjectPathIncludingArchivedPage(projectPath, limit, offset)
    : sessionsDb.getSessionsByProjectPathPage(projectPath, limit, offset);
  const total = includeArchived
    ? sessionsDb.countSessionsByProjectPathIncludingArchived(projectPath)
    : sessionsDb.countSessionsByProjectPath(projectPath);
  return { sessions: (rows as SessionRepositoryRow[]).map(summary), total, hasMore: offset + rows.length < total };
}

function sendProgress(progress: ProgressUpdate): void {
  const frame = JSON.stringify({ kind: 'loading_progress', ...progress });
  connectedClients.forEach((client: RealtimeClientConnection) => {
    if (client.readyState === WS_OPEN_STATE) client.send(frame);
  });
}

function eagerSessions(limit: number): Map<string, ProjectSessionsPageResult> {
  const perProject = new Map<string, ProjectSessionsPageResult>();
  for (const row of sessionsDb.getInitialSessionPagesByProject(limit) as InitialProjectSessionRow[]) {
    if (!row.project_path) continue;
    const found = perProject.get(row.project_path);
    if (found) {
      found.sessions.push(summary(row));
    } else {
      perProject.set(row.project_path, { sessions: [summary(row)], total: row.total, hasMore: row.total > limit });
    }
  }
  return perProject;
}

function pageMeta(): ProjectSessionsPageResult {
  return { sessions: [], total: 0, hasMore: false };
}

export async function getProjectsWithSessions(options: GetProjectsWithSessionsOptions = {}): Promise<ProjectListItem[]> {
  if (!options.skipSynchronization) await sessionSynchronizerService.synchronizeSessions();
  const records = projectsDb.getProjectPaths() as Array<{ project_id: string; project_path: string; custom_project_name?: string | null; origin?: 'legacy' | 'explicit' | 'auto' | null; isStarred?: number }>;
  const limit = Math.min(Math.max(1, options.sessionsLimit ?? initialPageSize), maxPageSize);
  const preloaded = eagerSessions(limit);
  const result: ProjectListItem[] = [];
  for (const [index, record] of records.entries()) {
    const projectPath = record.project_path;
    sendProgress({ phase: 'loading', current: index + 1, total: records.length, currentProject: projectPath });
    const customName = record.custom_project_name && record.custom_project_name.trim().length > 0
      ? record.custom_project_name
      : null;
    const displayName = customName ?? (options.skipSynchronization
      ? path.basename(projectPath) || projectPath
      : await generateDisplayName(path.basename(projectPath) || projectPath, projectPath));
    const sessions = options.sessionsOffset && options.sessionsOffset > 0
      ? sessionPage(projectPath, false, { limit, offset: options.sessionsOffset })
      : preloaded.get(projectPath) ?? pageMeta();
    result.push({
      projectId: record.project_id,
      path: projectPath,
      displayName,
      fullPath: projectPath,
      isStarred: Boolean(record.isStarred),
      origin: record.origin ?? 'legacy',
      sessions: sessions.sessions,
      sessionMeta: { hasMore: sessions.hasMore, total: sessions.total },
    });
  }
  sendProgress({ phase: 'complete', current: records.length, total: records.length });
  return result;
}

export async function getArchivedProjectsWithSessions(options: Pick<GetProjectsWithSessionsOptions, 'skipSynchronization' | 'sessionsLimit' | 'sessionsOffset'> = {}): Promise<ArchivedProjectListItem[]> {
  if (!options.skipSynchronization) await sessionSynchronizerService.synchronizeSessions();
  const records = projectsDb.getArchivedProjectPaths() as Array<{ project_id: string; project_path: string; custom_project_name?: string | null; origin?: 'legacy' | 'explicit' | 'auto' | null; isStarred?: number }>;
  const result: ArchivedProjectListItem[] = [];
  for (const record of records) {
    const projectPath = record.project_path;
    const displayName = record.custom_project_name && record.custom_project_name.trim().length > 0
      ? record.custom_project_name
      : await generateDisplayName(path.basename(projectPath) || projectPath, projectPath);
    const sessions = sessionPage(projectPath, true, { limit: options.sessionsLimit, offset: options.sessionsOffset });
    result.push({
      projectId: record.project_id, path: projectPath, displayName, fullPath: projectPath,
      isStarred: Boolean(record.isStarred), origin: record.origin ?? 'legacy', isArchived: true,
      sessions: sessions.sessions, sessionMeta: { hasMore: sessions.hasMore, total: sessions.total },
    });
  }
  return result;
}

export async function getProjectSessionsPage(projectId: string, options: SessionPaginationOptions = {}): Promise<ProjectSessionsPageApiView> {
  const project = projectsDb.getProjectById(projectId);
  if (!project) throw new AppError(`Project "${projectId}" was not found.`, { code: 'PROJECT_NOT_FOUND', statusCode: 404 });
  const sessions = sessionPage(project.project_path, false, options);
  return { projectId: project.project_id, sessions: sessions.sessions, sessionMeta: { hasMore: sessions.hasMore, total: sessions.total } };
}
