import assert from 'node:assert/strict';
import test from 'node:test';

import { projectsDb } from '@/modules/database/index.js';
import { applyLegacyStarredProjectIds, toggleProjectStar } from '@/modules/projects/services/project-star.service.js';
import { AppError } from '@/shared/utils.js';

type ProjectRow = { project_id: string; project_path: string; custom_project_name: string | null; isStarred: number; isArchived: number; origin: 'legacy' | 'explicit' | 'auto' };

function row(projectId: string, isStarred = 0): ProjectRow {
  return { project_id: projectId, project_path: `/workspace/${projectId}`, custom_project_name: projectId, isStarred, isArchived: 0, origin: 'legacy' };
}

function useStarRepository(
  lookup: typeof projectsDb.getProjectById,
  update: typeof projectsDb.updateProjectIsStarredById,
  check: () => void,
) {
  const originalLookup = projectsDb.getProjectById;
  const originalUpdate = projectsDb.updateProjectIsStarredById;
  projectsDb.getProjectById = lookup;
  projectsDb.updateProjectIsStarredById = update;
  try {
    check();
  } finally {
    projectsDb.getProjectById = originalLookup;
    projectsDb.updateProjectIsStarredById = originalUpdate;
  }
}

test('star toggling requires an ID and reports missing projects', () => {
  assert.throws(() => toggleProjectStar('   '), (error: unknown) =>
    error instanceof AppError && error.code === 'PROJECT_ID_REQUIRED' && error.statusCode === 400);
  useStarRepository(
    () => null,
    () => undefined,
    () => {
      assert.throws(() => toggleProjectStar('project-1'), (error: unknown) =>
        error instanceof AppError && error.code === 'PROJECT_NOT_FOUND' && error.statusCode === 404);
    },
  );
});

test('star toggling persists the inverse of the stored state', () => {
  const writes: Array<[string, boolean]> = [];
  useStarRepository(
    () => row('project-1'),
    (id, state) => {
      writes.push([id, state]);
    },
    () => {
      assert.deepEqual(toggleProjectStar('project-1'), { isStarred: true });
      assert.deepEqual(writes, [['project-1', true]]);
    },
  );
});

test('legacy star import ignores duplicates, blanks, missing rows, and existing stars', () => {
  const writes: string[] = [];
  useStarRepository(
    (id) => {
      if (id === 'project-a') return row(id);
      if (id === 'project-b') return row(id, 1);
      return null;
    },
    (id) => {
      writes.push(id);
    },
    () => {
      assert.deepEqual(
        applyLegacyStarredProjectIds(['project-a', 'project-b', 'missing-project', 'project-a', '', '   ']),
        { updated: 1 },
      );
      assert.deepEqual(writes, ['project-a']);
    },
  );
});
