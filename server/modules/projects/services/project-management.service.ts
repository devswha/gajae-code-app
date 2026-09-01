import fs from 'node:fs/promises';
import path from 'node:path';

import { isManagedWorktreePath, projectsDb } from '@/modules/database/index.js';
import type { CreateProjectPathResult, ProjectRepositoryRow, WorkspacePathValidationResult } from '@/shared/types.js';
import { AppError, normalizeProjectPath, validateWorkspacePath } from '@/shared/utils.js';

type CreateProjectInput = { projectPath: string; customName?: string | null };
type CreateProjectDependencies = {
  validatePath: (projectPath: string) => Promise<WorkspacePathValidationResult>; // workspace containment gate
  ensureWorkspaceDirectory: (projectPath: string) => Promise<void>; // provisions the directory on disk
  persistProjectPath: (projectPath: string, customName: string | null) => CreateProjectPathResult; // repository write
  getProjectByPath: (projectPath: string) => ProjectRepositoryRow | null; // repository read-back
};
// The seam exists for tests: production always passes the store below.

export type ProjectApiView = { projectId: string; path: string; fullPath: string; displayName: string; customName: string | null; origin: 'legacy' | 'explicit' | 'auto'; isArchived: boolean; isStarred: boolean; sessions: []; sessionMeta: { hasMore: false; total: 0 } };

type CreateProjectServiceResult = { outcome: 'created' | 'reactivated_archived'; project: ProjectApiView };

function projectDisplayName(projectPath: string, customName: string | null | undefined): string {
  const configuredName = typeof customName === 'string' ? customName.trim() : '';
  return configuredName || path.basename(projectPath) || projectPath;
}

async function provisionProjectDirectory(projectPath: string): Promise<void> {
  await fs.mkdir(projectPath, { recursive: true });
  const stats = await fs.stat(projectPath);
  if (stats.isDirectory()) return;

  throw new AppError('Path exists but is not a directory', {
    code: 'PROJECT_PATH_NOT_DIRECTORY',
    statusCode: 400,
  });
}

const projectStore: CreateProjectDependencies = {
  getProjectByPath: (projectPath) => projectsDb.getProjectPath(projectPath),
  persistProjectPath: (projectPath, customName) => projectsDb.createProjectPath(projectPath, customName),
  ensureWorkspaceDirectory: provisionProjectDirectory,
  validatePath: validateWorkspacePath, // shared workspace gate from utils
};

function projectApiView(project: ProjectRepositoryRow): ProjectApiView {
  const fullPath = project.project_path;
  const view: ProjectApiView = {
    projectId: project.project_id,
    path: fullPath, fullPath,
    displayName: projectDisplayName(fullPath, project.custom_project_name),
    customName: project.custom_project_name,
    origin: project.origin ?? 'legacy',
    isArchived: Boolean(project.isArchived),
    isStarred: Boolean(project.isStarred),
    sessions: [], sessionMeta: { hasMore: false, total: 0 },
  };
  return view;
}

function invalidProjectPath(details: unknown): AppError {
  return new AppError('Invalid project path', {
    code: 'INVALID_PROJECT_PATH',
    statusCode: 400,
    details: details ?? 'Path validation failed',
  });
}

function missingCreatedProject(message: string): AppError {
  return new AppError(message, {
    code: 'PROJECT_CREATE_FAILED',
    statusCode: 500,
  });
}

export async function createProject(input: CreateProjectInput, dependencies: CreateProjectDependencies = projectStore): Promise<CreateProjectServiceResult> {
  const requestedPath = normalizeProjectPath(input.projectPath || '');
  if (!requestedPath) {
    throw new AppError('path is required', { code: 'PROJECT_PATH_REQUIRED', statusCode: 400 });
  }
  if (isManagedWorktreePath(requestedPath)) {
    const rejection = { code: 'PROJECT_PATH_IS_MANAGED_WORKTREE', statusCode: 400 };
    throw new AppError('Managed job worktrees cannot be registered as projects', rejection);
  }

  const checkedPath = await dependencies.validatePath(requestedPath);
  if (!checkedPath.valid || !checkedPath.resolvedPath) throw invalidProjectPath(checkedPath.error);

  const resolvedPath = normalizeProjectPath(checkedPath.resolvedPath);
  await dependencies.ensureWorkspaceDirectory(resolvedPath);
  const stored = dependencies.persistProjectPath(resolvedPath, projectDisplayName(resolvedPath, input.customName));
  const project = stored.project ?? dependencies.getProjectByPath(resolvedPath);

  if (stored.outcome === 'active_conflict') {
    if (!project) throw missingCreatedProject('Failed to resolve existing project');
    const conflict = {
      code: 'PROJECT_ALREADY_EXISTS', statusCode: 409,
      details: { project: projectApiView(project) },
    };
    throw new AppError('Project path already exists and is active', conflict);
  }
  if (!project) throw missingCreatedProject('Failed to resolve project after creation');

  return { outcome: stored.outcome, project: projectApiView(project) };
}

export function promoteProjectOrigin(projectId: string): ProjectApiView {
  const normalizedId = projectId.trim();
  if (!normalizedId) {
    throw new AppError('Project ID is required.', { code: 'PROJECT_ID_REQUIRED', statusCode: 400 });
  }

  const promoted = projectsDb.promoteProjectOriginById(normalizedId);
  const project = promoted ?? projectsDb.getProjectById(normalizedId);
  if (!project) {
    throw new AppError(`Project "${projectId}" was not found.`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }
  return projectApiView(project);
}

export function updateProjectDisplayName(projectId: string, newDisplayName: unknown): void {
  const displayName = typeof newDisplayName === 'string' ? newDisplayName.trim() : '';
  projectsDb.updateCustomProjectNameById(projectId, displayName || null);
}
