import { projectsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

type ToggleProjectStarResult = { isStarred: boolean };
type ApplyLegacyStarredProjectIdsResult = { updated: number };

function requireProjectId(value: string): string {
  const projectId = value.trim();
  if (projectId) return projectId;

  throw new AppError('projectId is required', {
    code: 'PROJECT_ID_REQUIRED',
    statusCode: 400,
  });
}

function starCandidates(ids: string[]): Iterable<string> {
  return new Set(ids.map((id) => id.trim()).filter(Boolean));
}

export function applyLegacyStarredProjectIds(projectIds: string[]): ApplyLegacyStarredProjectIdsResult {
  let changes = 0;

  for (const projectId of starCandidates(projectIds)) {
    const storedProject = projectsDb.getProjectById(projectId);
    if (storedProject?.isStarred) continue;
    if (!storedProject) continue;

    projectsDb.updateProjectIsStarredById(projectId, true);
    changes += 1;
  }

  return { updated: changes };
}

export function toggleProjectStar(projectId: string): ToggleProjectStarResult {
  const id = requireProjectId(projectId);
  const storedProject = projectsDb.getProjectById(id);
  if (!storedProject) {
    throw new AppError('Project not found', {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  const isStarred = !storedProject.isStarred;
  projectsDb.updateProjectIsStarredById(id, isStarred);
  return { isStarred };
}
