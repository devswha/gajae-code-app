import { projectsDb as projectStore } from '@/modules/database/index.js';
import { AppError as ApplicationError } from '@/shared/utils.js';

type ToggleProjectStarResult = { isStarred: boolean };
type ApplyLegacyStarredProjectIdsResult = { updated: number };

function checkedProjectId(value: string): string {
  const projectId = value.trim();
  if (projectId) return projectId;

  throw new ApplicationError('projectId is required', {
    code: 'PROJECT_ID_REQUIRED',
    statusCode: 400,
  });
}

function distinctProjectIds(projectIds: string[]): Set<string> {
  const candidates = new Set<string>();
  for (const candidate of projectIds) {
    const normalized = candidate.trim();
    if (normalized) candidates.add(normalized);
  }
  return candidates;
}

export function applyLegacyStarredProjectIds(projectIds: string[]): ApplyLegacyStarredProjectIdsResult {
  let starredCount = 0;
  for (const candidateId of distinctProjectIds(projectIds)) {
    const project = projectStore.getProjectById(candidateId);
    if (!project || project.isStarred) continue;

    projectStore.updateProjectIsStarredById(candidateId, true);
    starredCount += 1;
  }
  return { updated: starredCount };
}

export function toggleProjectStar(projectId: string): ToggleProjectStarResult {
  const normalizedId = checkedProjectId(projectId);
  const project = projectStore.getProjectById(normalizedId);
  if (!project) throw new ApplicationError('Project not found', { code: 'PROJECT_NOT_FOUND', statusCode: 404 });

  const nextState = !project.isStarred;
  projectStore.updateProjectIsStarredById(normalizedId, nextState);
  return { isStarred: nextState };
}
