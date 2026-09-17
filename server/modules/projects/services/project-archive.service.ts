import { projectsDb as projectStore } from '@/modules/database/index.js';
import { AppError as ApplicationError } from '@/shared/utils.js';

function unknownProject(projectId: string): ApplicationError {
  return new ApplicationError(`Unknown projectId: ${projectId}`, {
    code: 'PROJECT_NOT_FOUND',
    statusCode: 404,
  });
}

// Archiving is the only removal this product offers for a project. It flips a
// flag: the project row, its session rows and every transcript on disk survive,
// and `restoreArchivedProject` brings the workspace back exactly as it was.
// There is deliberately no path here that deletes a user's files - the sidebar
// action is undoable or it does not exist.
export function archiveProject(projectId: string): void {
  const project = projectStore.getProjectById(projectId);
  if (!project) throw unknownProject(projectId);
  projectStore.updateProjectIsArchivedById(projectId, true);
}

export function restoreArchivedProject(projectId: string): void {
  const project = projectStore.getProjectById(projectId);
  if (!project) throw unknownProject(projectId);
  projectStore.updateProjectIsArchivedById(projectId, false);
}
