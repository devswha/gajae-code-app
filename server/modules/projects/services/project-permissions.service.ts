import { DEFAULT_GJC_PERMISSION_MODE, isGjcPermissionMode, isGjcPermissionToolName, type GjcRunPermissions } from '@/gjc-engine.js';
import { projectPermissionsDb, projectsDb } from '@/modules/database/index.js';
import type { ProjectPermissionMode, ProjectPermissionsRow, ProjectRepositoryRow } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** What the REST surface returns; the row plus the id the client addresses it by. */
export type ProjectPermissionsView = {
  projectId: string;
  projectPath: string;
  mode: ProjectPermissionMode;
  allowAlways: string[];
  updatedAt: string | null;
};

export type UpdateProjectPermissionModeInput = { mode: unknown };

function view(project: ProjectRepositoryRow, row: ProjectPermissionsRow): ProjectPermissionsView {
  return {
    projectId: project.project_id,
    projectPath: project.project_path,
    mode: row.mode,
    allowAlways: row.allow_always,
    updatedAt: row.updated_at,
  };
}

function requireProject(projectId: string): ProjectRepositoryRow {
  const id = typeof projectId === 'string' ? projectId.trim() : '';
  if (!id) throw new AppError('projectId is required', { code: 'PROJECT_ID_REQUIRED', statusCode: 400 });
  const project = projectsDb.getProjectById(id);
  if (!project) throw new AppError(`Project "${projectId}" was not found.`, { code: 'PROJECT_NOT_FOUND', statusCode: 404 });
  return project;
}

function requireToolName(value: unknown): string {
  if (!isGjcPermissionToolName(value)) {
    throw new AppError('toolName must be a runtime tool identifier', { code: 'INVALID_TOOL_NAME', statusCode: 400 });
  }
  return value;
}

export function getProjectPermissions(projectId: string): ProjectPermissionsView {
  const project = requireProject(projectId);
  return view(project, projectPermissionsDb.get(project.project_path));
}

/** Switches the mode. Every mode, bypass included, is one request away, as in the CLI. */
export function updateProjectPermissionMode(projectId: string, input: UpdateProjectPermissionModeInput): ProjectPermissionsView {
  const project = requireProject(projectId);
  if (!isGjcPermissionMode(input.mode)) {
    throw new AppError('mode must be one of ask, auto_edits, bypass', { code: 'INVALID_PERMISSION_MODE', statusCode: 400 });
  }
  return view(project, projectPermissionsDb.setMode(project.project_path, input.mode));
}

export function revokeProjectAlwaysAllow(projectId: string, toolName: unknown): ProjectPermissionsView {
  const project = requireProject(projectId);
  return view(project, projectPermissionsDb.removeAllowAlways(project.project_path, requireToolName(toolName)));
}

export function resetProjectPermissions(projectId: string): ProjectPermissionsView {
  const project = requireProject(projectId);
  return view(project, projectPermissionsDb.reset(project.project_path));
}

/** Every project whose policy differs from the default, for the Settings listing. */
export function listConfiguredProjectPermissions(): ProjectPermissionsView[] {
  const views: ProjectPermissionsView[] = [];
  for (const row of projectPermissionsDb.listConfigured()) {
    const project = projectsDb.getProjectPath(row.project_path);
    if (project) views.push(view(project, row));
  }
  return views;
}

/**
 * Records "Always allow <tool>" from a permission card. Addressed by project
 * path because that is what a session row carries; the tool name comes from
 * the request the server itself raised, never from the browser.
 */
export function grantProjectAlwaysAllow(projectPath: string, toolName: unknown): ProjectPermissionsRow | null {
  if (!projectPath || !isGjcPermissionToolName(toolName)) return null;
  if (!projectsDb.getProjectPath(projectPath)) return null;
  return projectPermissionsDb.addAllowAlways(projectPath, toolName);
}

/** The policy block a run's options carry to the worker. */
export function resolveRunPermissions(projectPath: string | null | undefined): GjcRunPermissions {
  if (!projectPath) return { mode: DEFAULT_GJC_PERMISSION_MODE, allowAlways: [] };
  const row = projectPermissionsDb.get(projectPath);
  return { mode: row.mode, allowAlways: row.allow_always };
}
