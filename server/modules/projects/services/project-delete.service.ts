import { promises as fileSystem } from 'node:fs';
import nodePath from 'node:path';

import { projectsDb as projectStore, sessionsDb as sessionStore } from '@/modules/database/index.js';
import { AppError as ApplicationError } from '@/shared/utils.js';

function unknownProject(projectId: string): ApplicationError {
  return new ApplicationError(`Unknown projectId: ${projectId}`, {
    code: 'PROJECT_NOT_FOUND',
    statusCode: 404,
  });
}

function uniqueSessionFilePaths(rows: Array<{ jsonl_path: string | null }>): string[] {
  const paths = new Set<string>();
  rows.forEach(({ jsonl_path: jsonlPath }) => {
    const filename = jsonlPath?.trim();
    if (!filename) return;
    paths.add(nodePath.isAbsolute(filename) ? nodePath.normalize(filename) : nodePath.resolve(filename));
  });
  return Array.from(paths);
}

async function discardSessionFile(filename: string): Promise<void> {
  // Already-gone files are the desired end state; anything else is only worth a warning.
  await fileSystem.unlink(filename).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return;
    console.warn(`[project-delete] Failed to remove ${filename}:`, error.message);
  });
}

export async function deleteSessionJsonlFilesForProjectPath(projectPath: string): Promise<void> {
  const sessions = sessionStore.getSessionsByProjectPathIncludingArchived(projectPath);
  for (const filename of uniqueSessionFilePaths(sessions)) {
    await discardSessionFile(filename);
  }
}

export async function deleteOrArchiveProject(projectId: string, force: boolean): Promise<void> {
  const project = projectStore.getProjectById(projectId);
  if (!project) throw unknownProject(projectId);

  if (!force) return void projectStore.updateProjectIsArchivedById(projectId, true);

  await deleteSessionJsonlFilesForProjectPath(project.project_path);
  sessionStore.deleteSessionsByProjectPath(project.project_path);
  projectStore.deleteProjectById(projectId);
}

export function restoreArchivedProject(projectId: string): void {
  const project = projectStore.getProjectById(projectId);
  if (!project) throw unknownProject(projectId);
  projectStore.updateProjectIsArchivedById(projectId, false);
}
