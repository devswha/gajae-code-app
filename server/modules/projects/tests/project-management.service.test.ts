import assert from 'node:assert/strict';
import test from 'node:test';

import { projectsDb } from '@/modules/database/index.js';
import { createProject, promoteProjectOrigin } from '@/modules/projects/services/project-management.service.js';
import { AppError } from '@/shared/utils.js';

const storedProject = {
  project_id: 'project-1',
  project_path: '/workspace/my-project',
  custom_project_name: 'my-project',
  isStarred: 0,
  isArchived: 0,
  origin: 'legacy' as const,
};

function projectDependencies(overrides: Partial<NonNullable<Parameters<typeof createProject>[1]>> = {}) {
  return {
    validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
    ensureWorkspaceDirectory: async () => undefined,
    persistProjectPath: () => ({ outcome: 'created' as const, project: storedProject }),
    getProjectByPath: () => storedProject,
    ...overrides,
  };
}

function assertServiceError(error: unknown, code: string, statusCode: number): asserts error is AppError {
  assert.ok(error instanceof AppError);
  assert.equal(error.code, code);
  assert.equal(error.statusCode, statusCode);
}

function withProjectRepository(
  replacements: Pick<typeof projectsDb, 'promoteProjectOriginById' | 'getProjectById'>,
  check: () => void,
) {
  const previousPromotion = projectsDb.promoteProjectOriginById;
  const previousLookup = projectsDb.getProjectById;
  projectsDb.promoteProjectOriginById = replacements.promoteProjectOriginById;
  projectsDb.getProjectById = replacements.getProjectById;
  try {
    check();
  } finally {
    projectsDb.promoteProjectOriginById = previousPromotion;
    projectsDb.getProjectById = previousLookup;
  }
}

test('project creation rejects absent and invalid paths with validation details', async () => {
  await assert.rejects(
    () => createProject({ projectPath: '' }),
    (error: unknown) => {
      assertServiceError(error, 'PROJECT_PATH_REQUIRED', 400);
      return true;
    },
  );
  await assert.rejects(
    () =>
      createProject(
        { projectPath: '/invalid/path' },
        projectDependencies({ validatePath: async () => ({ valid: false, error: 'blocked path' }) }),
      ),
    (error: unknown) => {
      assertServiceError(error, 'INVALID_PROJECT_PATH', 400);
      assert.equal(error.details, 'blocked path');
      return true;
    },
  );
});

test('project creation exposes an active duplicate as its API project view', async () => {
  await assert.rejects(
    () =>
      createProject(
        { projectPath: storedProject.project_path },
        projectDependencies({ persistProjectPath: () => ({ outcome: 'active_conflict', project: storedProject }) }),
      ),
    (error: unknown) => {
      assertServiceError(error, 'PROJECT_ALREADY_EXISTS', 409);
      assert.deepEqual(error.details, {
        project: {
          projectId: 'project-1',
          path: '/workspace/my-project',
          fullPath: '/workspace/my-project',
          displayName: 'my-project',
          customName: 'my-project',
          origin: 'legacy',
          isArchived: false,
          isStarred: false,
          sessions: [],
          sessionMeta: { hasMore: false, total: 0 },
        },
      });
      return true;
    },
  );
});

test('project creation names unnamed directories and returns archived reactivations', async () => {
  let savedName: string | null = null;
  const created = await createProject(
    { projectPath: storedProject.project_path, customName: '' },
    projectDependencies({
      persistProjectPath: (_projectPath, name) => {
        savedName = name;
        return { outcome: 'created', project: { ...storedProject, custom_project_name: name } };
      },
    }),
  );
  assert.equal(savedName, 'my-project');
  assert.deepEqual({ outcome: created.outcome, displayName: created.project.displayName }, {
    outcome: 'created',
    displayName: 'my-project',
  });

  const reactivated = await createProject(
    { projectPath: storedProject.project_path },
    projectDependencies({
      persistProjectPath: () => ({ outcome: 'reactivated_archived', project: { ...storedProject, isArchived: 1 } }),
    }),
  );
  assert.deepEqual(
    { outcome: reactivated.outcome, isArchived: reactivated.project.isArchived },
    { outcome: 'reactivated_archived', isArchived: true },
  );
});

test('origin promotion maps auto and legacy repository rows without a second lookup', () => {
  const rows = [
    { ...storedProject, project_id: 'auto-project', project_path: '/workspace/auto-project', custom_project_name: 'Auto project', isStarred: 1, origin: 'auto' as const },
    { ...storedProject, project_id: 'legacy-project', project_path: '/workspace/legacy-project', custom_project_name: null, isArchived: 1 },
  ];
  const promoted: string[] = [];
  withProjectRepository(
    {
      promoteProjectOriginById: (id) => {
        const row = rows.find((candidate) => candidate.project_id === id);
        if (!row) return null;
        promoted.push(id);
        return { ...row, origin: 'explicit' };
      },
      getProjectById: () => {
        throw new Error('Promoted rows must be used directly');
      },
    },
    () => {
      const views = rows.map((row) => promoteProjectOrigin(row.project_id));
      assert.deepEqual(promoted, ['auto-project', 'legacy-project']);
      assert.deepEqual(views, [
        { projectId: 'auto-project', path: '/workspace/auto-project', fullPath: '/workspace/auto-project', displayName: 'Auto project', customName: 'Auto project', origin: 'explicit', isArchived: false, isStarred: true, sessions: [], sessionMeta: { hasMore: false, total: 0 } },
        { projectId: 'legacy-project', path: '/workspace/legacy-project', fullPath: '/workspace/legacy-project', displayName: 'legacy-project', customName: null, origin: 'explicit', isArchived: true, isStarred: false, sessions: [], sessionMeta: { hasMore: false, total: 0 } },
      ]);
    },
  );
});

test('origin promotion returns explicit rows and rejects unknown or blank IDs', () => {
  const explicit = { ...storedProject, project_id: 'explicit-project', custom_project_name: 'Explicit project', isStarred: 1, isArchived: 1, origin: 'explicit' as const };
  withProjectRepository(
    {
      promoteProjectOriginById: (id) => (id === explicit.project_id ? explicit : null),
      getProjectById: (id) => {
        if (id === explicit.project_id) {
          throw new Error('Explicit promotion must not perform a fallback lookup');
        }
        return null;
      },
    },
    () => {
      assert.deepEqual(promoteProjectOrigin(explicit.project_id), {
        projectId: 'explicit-project', path: '/workspace/my-project', fullPath: '/workspace/my-project', displayName: 'Explicit project', customName: 'Explicit project', origin: 'explicit', isArchived: true, isStarred: true, sessions: [], sessionMeta: { hasMore: false, total: 0 },
      });
      assert.throws(() => promoteProjectOrigin('missing-project'), (error: unknown) => {
        assertServiceError(error, 'PROJECT_NOT_FOUND', 404);
        return true;
      });
    },
  );
  withProjectRepository(
    {
      promoteProjectOriginById: () => {
        throw new Error('Blank IDs cannot query the repository');
      },
      getProjectById: () => {
        throw new Error('Blank IDs cannot query the repository');
      },
    },
    () => {
      for (const value of ['', '   ']) {
        assert.throws(() => promoteProjectOrigin(value), (error: unknown) => {
          assertServiceError(error, 'PROJECT_ID_REQUIRED', 400);
          return true;
        });
      }
    },
  );
});
