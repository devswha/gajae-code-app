import fs from 'node:fs/promises';
import path from 'node:path';

import { projectsDb } from '@/modules/database/index.js';
import { projectApiView, type ProjectApiView } from '@/modules/projects/services/project-management.service.js';
import { scoreWorkspaceCandidates, type WorkspaceCandidate, type WorkspaceScoringChild } from '@/modules/projects/services/workspace-target-scoring.js';
import type { ProjectRepositoryRow } from '@/shared/types.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';

export type { WorkspaceCandidate };

export type ResolveWorkspaceTargetResult = {
  isWorkspace: boolean;
  candidates: WorkspaceCandidate[];
};

export type DescendIntoChildResult = {
  created: boolean;
  project: ProjectApiView;
};

function unknownProject(projectId: string): AppError {
  return new AppError(`Unknown projectId: ${projectId}`, { code: 'PROJECT_NOT_FOUND', statusCode: 404 });
}

async function hasGitEntry(directoryPath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(directoryPath, '.git'));
    return true;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === 'ENOENT') return false;
    throw failure;
  }
}

function isCandidateDirName(name: string): boolean {
  return name !== 'node_modules' && !name.startsWith('.');
}

async function readPackageName(directoryPath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(directoryPath, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { name?: unknown };
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name) return null;
    // Scoped packages (`@scope/name`) contribute only the unscoped segment.
    return name.startsWith('@') ? name.split('/').slice(1).join('/') || null : name;
  } catch {
    return null;
  }
}

/**
 * Lists the immediate child directories of `dir` that are themselves git repositories
 * (contain a `.git` entry). Hidden directories and `node_modules` are never candidates.
 */
export async function listChildRepos(dir: string): Promise<WorkspaceScoringChild[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const children: WorkspaceScoringChild[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isCandidateDirName(entry.name)) continue;
    const childPath = path.join(dir, entry.name);
    if (!(await hasGitEntry(childPath))) continue;
    const stats = await fs.stat(childPath);
    children.push({
      path: childPath,
      name: entry.name,
      packageName: await readPackageName(childPath),
      mtimeMs: stats.mtimeMs,
    });
  }
  return children;
}

/**
 * A workspace root is a directory that is not itself a git work tree, but that
 * contains at least one immediate child directory that is one.
 */
export async function isWorkspaceRoot(dir: string): Promise<boolean> {
  if (await hasGitEntry(dir)) return false;
  const children = await listChildRepos(dir);
  return children.length > 0;
}

function projectRowOrThrow(projectId: string): ProjectRepositoryRow {
  const project = projectsDb.getProjectById(projectId);
  if (!project) throw unknownProject(projectId);
  return project;
}

export async function resolveWorkspaceTarget(projectId: string, text: string): Promise<ResolveWorkspaceTargetResult> {
  const project = projectRowOrThrow(projectId);
  if (!(await isWorkspaceRoot(project.project_path))) {
    return { isWorkspace: false, candidates: [] };
  }
  const children = await listChildRepos(project.project_path);
  return { isWorkspace: true, candidates: scoreWorkspaceCandidates(text, children) };
}

function notWorkspaceChild(message: string): AppError {
  return new AppError(message, { code: 'NOT_WORKSPACE_CHILD', statusCode: 400 });
}

export async function descendIntoChild(projectId: string, childPath: string): Promise<DescendIntoChildResult> {
  const project = projectRowOrThrow(projectId);
  if (!(await isWorkspaceRoot(project.project_path))) {
    throw notWorkspaceChild('Project is not a workspace root');
  }

  const children = await listChildRepos(project.project_path);
  const resolvedChildPath = normalizeProjectPath(path.resolve(childPath));
  const matchedChild = children.find((child) => normalizeProjectPath(child.path) === resolvedChildPath);
  if (!matchedChild) {
    throw notWorkspaceChild('path is not an immediate child repository of the workspace project');
  }

  // The user chose this repo to work in, so it becomes a sidebar project the
  // same way "Add a project" does: created or un-archived as 'explicit', and a
  // row the session indexer had only discovered ('auto'/'legacy') is promoted.
  const { outcome, project: child } = projectsDb.createProjectPath(matchedChild.path);
  if (!child) {
    throw new AppError('Failed to register project for workspace child', { code: 'PROJECT_CREATE_FAILED', statusCode: 500 });
  }
  const row = outcome === 'active_conflict' && child.origin !== 'explicit'
    ? projectsDb.promoteProjectOriginById(child.project_id) ?? child
    : child;
  return { created: outcome === 'created', project: projectApiView(row) };
}
