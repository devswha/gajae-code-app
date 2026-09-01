import assert from 'node:assert/strict';
import test from 'node:test';

import { projectsDb } from '@/modules/database/index.js';
import { applyLegacyStarredProjectIds, toggleProjectStar } from '@/modules/projects/services/project-star.service.js';
import { AppError } from '@/shared/utils.js';

type ProjectRow = { project_id: string; project_path: string; custom_project_name: string | null; isStarred: number; isArchived: number; origin: 'legacy' | 'explicit' | 'auto' };

function storedProject(projectId: string, isStarred = 0): ProjectRow {
  return {
    project_id: projectId,
    project_path: `/workspaces/gajae/${projectId}`,
    custom_project_name: `Gajae ${projectId}`,
    isStarred,
    isArchived: 0,
    origin: 'legacy',
  };
}

function withStarStorage(
  replacements: Pick<typeof projectsDb, 'getProjectById' | 'updateProjectIsStarredById'>,
  action: () => void,
): void {
  const original = {
    getProjectById: projectsDb.getProjectById,
    updateProjectIsStarredById: projectsDb.updateProjectIsStarredById,
  };
  Object.assign(projectsDb, replacements);
  try {
    action();
  } finally {
    Object.assign(projectsDb, original);
  }
}

function expectProjectError(action: () => unknown, code: string, statusCode: number): void {
  assert.throws(action, (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode,
  );
}

test('starring requires an existing project identifier', () => {
  expectProjectError(() => toggleProjectStar('   '), 'PROJECT_ID_REQUIRED', 400);

  withStarStorage(
    { getProjectById: () => null, updateProjectIsStarredById: () => undefined },
    () => expectProjectError(() => toggleProjectStar('gajae-migrator'), 'PROJECT_NOT_FOUND', 404),
  );
});

test('a star request stores and returns the inverse of the project state', () => {
  const updates: Array<[string, boolean]> = [];
  withStarStorage(
    {
      getProjectById: () => storedProject('gajae-migrator'),
      updateProjectIsStarredById: (projectId, isStarred) => updates.push([projectId, isStarred]),
    },
    () => assert.deepEqual(toggleProjectStar('gajae-migrator'), { isStarred: true }),
  );

  assert.deepEqual(updates, [['gajae-migrator', true]]);
});

test('legacy favorites apply once to known projects that are not already starred', () => {
  const updates: string[] = [];
  const projectStates: Record<string, ProjectRow> = {
    'gajae-console': storedProject('gajae-console'),
    'gajae-docs': storedProject('gajae-docs', 1),
  };
  withStarStorage(
    {
      getProjectById: (projectId) => projectStates[projectId] ?? null,
      updateProjectIsStarredById: (projectId) => updates.push(projectId),
    },
    () => {
      const imported = applyLegacyStarredProjectIds([
        'gajae-console',
        'gajae-docs',
        'missing-gajae-project',
        'gajae-console',
        '',
        '   ',
      ]);
      assert.deepEqual(imported, { updated: 1 });
    },
  );

  assert.deepEqual(updates, ['gajae-console']);
});
