import { promises as fs } from 'node:fs';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

function projectNotFound(projectId: string): AppError {
  return new AppError(`Unknown projectId: ${projectId}`, {
    code: 'PROJECT_NOT_FOUND',
    statusCode: 404,
  });
}

function sessionFiles(rows: Array<{ jsonl_path: string | null }>): string[] {
  const files = new Set<string>();

  for (const { jsonl_path: candidate } of rows) {
    const trimmed = candidate?.trim();
    if (trimmed) files.add(path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(trimmed));
  }

  return [...files];
}

async function removeSessionFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[project-delete] Failed to remove ${filePath}:`, (error as Error).message);
    }
  }
}

export async function deleteSessionJsonlFilesForProjectPath(projectPath: string): Promise<void> {
  const sessionRows = sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath);
  for (const filePath of sessionFiles(sessionRows)) await removeSessionFile(filePath);
}

export async function deleteOrArchiveProject(projectId: string, force: boolean): Promise<void> {
  const project = projectsDb.getProjectById(projectId);
  if (!project) throw projectNotFound(projectId);

  if (force) {
    await deleteSessionJsonlFilesForProjectPath(project.project_path);
    sessionsDb.deleteSessionsByProjectPath(project.project_path);
    projectsDb.deleteProjectById(projectId);
    return;
  }

  projectsDb.updateProjectIsArchivedById(projectId, true);
}

export function restoreArchivedProject(projectId: string): void {
  if (!projectsDb.getProjectById(projectId)) throw projectNotFound(projectId);
  projectsDb.updateProjectIsArchivedById(projectId, false);
}
