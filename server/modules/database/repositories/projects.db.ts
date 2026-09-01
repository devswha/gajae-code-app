import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { getConnection } from '@/modules/database/connection.js';
import type { CreateProjectPathResult, ProjectRepositoryRow } from '@/shared/types.js';
import { normalizeProjectPath } from '@/shared/utils.js';

const PROJECT_COLUMNS = 'project_id, project_path, custom_project_name, isStarred, isArchived, origin';

function defaultNameFor(projectPath: string, suppliedName: string | null): string {
  const name = typeof suppliedName === 'string' ? suppliedName.trim() : '';
  return name || path.basename(projectPath) || projectPath;
}

function canonicalPath(projectPath: string): string {
  return normalizeProjectPath(projectPath);
}

function rowForPath(projectPath: string): ProjectRepositoryRow | null {
  const row = getConnection()
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE project_path = ?`)
    .get(canonicalPath(projectPath)) as ProjectRepositoryRow | undefined;
  return row ?? null;
}

function rowForId(projectId: string): ProjectRepositoryRow | null {
  const row = getConnection()
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE project_id = ?`)
    .get(projectId) as ProjectRepositoryRow | undefined;
  return row ?? null;
}

function changeFlag(column: 'isStarred' | 'isArchived', projectPath: string, enabled: boolean): void {
  getConnection()
    .prepare(`UPDATE projects SET ${column} = ? WHERE project_path = ?`)
    .run(Number(enabled), canonicalPath(projectPath));
}

function changeFlagById(column: 'isStarred' | 'isArchived', projectId: string, enabled: boolean): void {
  getConnection()
    .prepare(`UPDATE projects SET ${column} = ? WHERE project_id = ?`)
    .run(Number(enabled), projectId);
}

export function isManagedWorktreePath(projectPath: string): boolean {
  return canonicalPath(projectPath).split(/[\\/]/).some((part) => part === '.gjc-worktrees');
}

function visibleProjects(archived: boolean): ProjectRepositoryRow[] {
  const records = getConnection()
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE isArchived = ?`)
    .all(Number(archived)) as ProjectRepositoryRow[];
  return records.filter(({ project_path: projectPath }) => !isManagedWorktreePath(projectPath));
}

function createProjectPath(projectPath: string, customProjectName: string | null = null): CreateProjectPathResult {
  const normalizedPath = canonicalPath(projectPath);
  const generatedId = randomUUID();
  const result = getConnection().prepare(`
    INSERT INTO projects (project_id, project_path, custom_project_name, isArchived, origin)
    VALUES (?, ?, ?, 0, 'explicit')
    ON CONFLICT(project_path) DO UPDATE SET isArchived = 0, origin = 'explicit'
    WHERE projects.isArchived = 1
    RETURNING ${PROJECT_COLUMNS}
  `).get(generatedId, normalizedPath, defaultNameFor(normalizedPath, customProjectName)) as ProjectRepositoryRow | undefined;

  if (result) {
    return {
      outcome: result.project_id === generatedId ? 'created' : 'reactivated_archived',
      project: result,
    };
  }
  return { outcome: 'active_conflict', project: rowForPath(normalizedPath) };
}

function ensureProjectPathForSession(projectPath: string): void {
  const normalizedPath = canonicalPath(projectPath);
  getConnection().prepare(`
    INSERT INTO projects (project_id, project_path, custom_project_name, isArchived, origin)
    VALUES (?, ?, ?, 0, 'auto')
    ON CONFLICT(project_path) DO NOTHING
  `).run(randomUUID(), normalizedPath, defaultNameFor(normalizedPath, null));
}

function getProjectPathById(projectId: string): string | null {
  const row = getConnection()
    .prepare('SELECT project_path FROM projects WHERE project_id = ?')
    .get(projectId) as { project_path: string } | undefined;
  return row?.project_path ?? null;
}

function getCustomProjectName(projectPath: string): string | null {
  const row = getConnection()
    .prepare('SELECT custom_project_name FROM projects WHERE project_path = ?')
    .get(canonicalPath(projectPath)) as { custom_project_name: string | null } | undefined;
  return row?.custom_project_name ?? null;
}

function updateCustomProjectName(projectPath: string, customProjectName: string | null): void {
  const normalizedPath = canonicalPath(projectPath);
  getConnection().prepare(`
    INSERT INTO projects (project_id, project_path, custom_project_name)
    VALUES (?, ?, ?)
    ON CONFLICT(project_path) DO UPDATE SET custom_project_name = excluded.custom_project_name
  `).run(randomUUID(), normalizedPath, customProjectName);
}

function updateCustomProjectNameById(projectId: string, customProjectName: string | null): void {
  getConnection().prepare('UPDATE projects SET custom_project_name = ? WHERE project_id = ?').run(customProjectName, projectId);
}

function promoteProjectOriginById(projectId: string): ProjectRepositoryRow | null {
  const row = getConnection().prepare(`
    UPDATE projects SET origin = 'explicit'
    WHERE project_id = ? AND origin IN ('auto', 'legacy')
    RETURNING ${PROJECT_COLUMNS}
  `).get(projectId) as ProjectRepositoryRow | undefined;
  return row ?? null;
}

function deleteProjectPath(projectPath: string): void {
  getConnection().prepare('DELETE FROM projects WHERE project_path = ?').run(canonicalPath(projectPath));
}

function deleteProjectById(projectId: string): void {
  getConnection().prepare('DELETE FROM projects WHERE project_id = ?').run(projectId);
}

export const projectsDb = {
  createProjectPath,
  ensureProjectPathForSession,
  getProjectPath: rowForPath,
  getProjectById: rowForId,
  getProjectPathById,
  getProjectPaths: () => visibleProjects(false),
  getArchivedProjectPaths: () => visibleProjects(true),
  getCustomProjectName,
  updateCustomProjectName,
  updateCustomProjectNameById,
  promoteProjectOriginById,
  updateProjectIsStarred: (projectPath: string, isStarred: boolean) => changeFlag('isStarred', projectPath, isStarred),
  updateProjectIsStarredById: (projectId: string, isStarred: boolean) => changeFlagById('isStarred', projectId, isStarred),
  updateProjectIsArchived: (projectPath: string, isArchived: boolean) => changeFlag('isArchived', projectPath, isArchived),
  updateProjectIsArchivedById: (projectId: string, isArchived: boolean) => changeFlagById('isArchived', projectId, isArchived),
  deleteProjectPath,
  deleteProjectById,
};
