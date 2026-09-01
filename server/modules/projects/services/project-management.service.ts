import fs from 'node:fs/promises';
import path from 'node:path';

import { isManagedWorktreePath, projectsDb } from '@/modules/database/index.js';
import type { CreateProjectPathResult, ProjectRepositoryRow, WorkspacePathValidationResult } from '@/shared/types.js';
import { AppError, normalizeProjectPath, validateWorkspacePath } from '@/shared/utils.js';

type CreateProjectInput = { projectPath: string; customName?: string | null };
type CreateProjectDependencies = { validatePath: (projectPath: string) => Promise<WorkspacePathValidationResult>; ensureWorkspaceDirectory: (projectPath: string) => Promise<void>; persistProjectPath: (projectPath: string, customName: string | null) => CreateProjectPathResult; getProjectByPath: (projectPath: string) => ProjectRepositoryRow | null };

export type ProjectApiView = { projectId: string; path: string; fullPath: string; displayName: string; customName: string | null; origin: 'legacy' | 'explicit' | 'auto'; isArchived: boolean; isStarred: boolean; sessions: []; sessionMeta: { hasMore: false; total: 0 } };

type CreateProjectServiceResult = { outcome: 'created' | 'reactivated_archived'; project: ProjectApiView };

function displayNameFor(projectPath: string, customName: string | null | undefined): string {
  const suppliedName = typeof customName === 'string' ? customName.trim() : '';
  return suppliedName || path.basename(projectPath) || projectPath;
}

async function createWorkspaceDirectory(projectPath: string): Promise<void> {
  await fs.mkdir(projectPath, { recursive: true });
  if (!(await fs.stat(projectPath)).isDirectory()) {
    throw new AppError('Path exists but is not a directory', {
      code: 'PROJECT_PATH_NOT_DIRECTORY',
      statusCode: 400,
    });
  }
}

const repositoryDependencies: CreateProjectDependencies = {
  validatePath: validateWorkspacePath,
  ensureWorkspaceDirectory: createWorkspaceDirectory,
  persistProjectPath: (projectPath, customName) => projectsDb.createProjectPath(projectPath, customName),
  getProjectByPath: (projectPath) => projectsDb.getProjectPath(projectPath),
};

function asApiProject(row: ProjectRepositoryRow): ProjectApiView {
  const projectPath = row.project_path;
  return {
    projectId: row.project_id,
    path: projectPath,
    fullPath: projectPath,
    displayName: displayNameFor(projectPath, row.custom_project_name),
    customName: row.custom_project_name,
    origin: row.origin ?? 'legacy',
    isArchived: Boolean(row.isArchived),
    isStarred: Boolean(row.isStarred),
    sessions: [],
    sessionMeta: { hasMore: false, total: 0 },
  };
}

function invalidProjectPath(details: unknown): AppError {
  return new AppError('Invalid project path', {
    code: 'INVALID_PROJECT_PATH',
    statusCode: 400,
    details: details ?? 'Path validation failed',
  });
}

export async function createProject(
  input: CreateProjectInput,
  dependencies: CreateProjectDependencies = repositoryDependencies,
): Promise<CreateProjectServiceResult> {
  const requestedPath = normalizeProjectPath(input.projectPath || '');
  if (!requestedPath) {
    throw new AppError('path is required', { code: 'PROJECT_PATH_REQUIRED', statusCode: 400 });
  }
  if (isManagedWorktreePath(requestedPath)) {
    throw new AppError('Managed job worktrees cannot be registered as projects', {
      code: 'PROJECT_PATH_IS_MANAGED_WORKTREE',
      statusCode: 400,
    });
  }

  const validation = await dependencies.validatePath(requestedPath);
  if (!validation.valid || !validation.resolvedPath) throw invalidProjectPath(validation.error);

  const resolvedPath = normalizeProjectPath(validation.resolvedPath);
  await dependencies.ensureWorkspaceDirectory(resolvedPath);
  const saved = dependencies.persistProjectPath(resolvedPath, displayNameFor(resolvedPath, input.customName));
  const row = saved.project ?? dependencies.getProjectByPath(resolvedPath);

  if (saved.outcome === 'active_conflict') {
    if (!row) {
      throw new AppError('Failed to resolve existing project', {
        code: 'PROJECT_CREATE_FAILED',
        statusCode: 500,
      });
    }
    throw new AppError('Project path already exists and is active', {
      code: 'PROJECT_ALREADY_EXISTS',
      statusCode: 409,
      details: { project: asApiProject(row) },
    });
  }

  if (!row) {
    throw new AppError('Failed to resolve project after creation', {
      code: 'PROJECT_CREATE_FAILED',
      statusCode: 500,
    });
  }
  return { outcome: saved.outcome, project: asApiProject(row) };
}

export function promoteProjectOrigin(projectId: string): ProjectApiView {
  const id = projectId.trim();
  if (!id) {
    throw new AppError('Project ID is required.', { code: 'PROJECT_ID_REQUIRED', statusCode: 400 });
  }

  const project = projectsDb.promoteProjectOriginById(id) ?? projectsDb.getProjectById(id);
  if (!project) {
    throw new AppError(`Project "${projectId}" was not found.`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }
  return asApiProject(project);
}

export function updateProjectDisplayName(projectId: string, newDisplayName: unknown): void {
  const name = typeof newDisplayName === 'string' ? newDisplayName.trim() : '';
  projectsDb.updateCustomProjectNameById(projectId, name || null);
}
