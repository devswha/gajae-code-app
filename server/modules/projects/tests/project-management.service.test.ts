import assert from 'node:assert/strict';
import test from 'node:test';

import { projectsDb } from '@/modules/database/index.js';
import { createProject, promoteProjectOrigin } from '@/modules/projects/services/project-management.service.js';
import { AppError } from '@/shared/utils.js';

const projectFixture = {
  project_id: 'gajae-dashboard',
  project_path: '/workspaces/gajae/dashboard',
  custom_project_name: 'Gajae dashboard',
  isStarred: 0,
  isArchived: 0,
  origin: 'legacy' as const,
};

function createDependencies(overrides: Partial<NonNullable<Parameters<typeof createProject>[1]>> = {}) {
  return {
    validatePath: async () => ({ valid: true, resolvedPath: projectFixture.project_path }),
    ensureWorkspaceDirectory: async () => undefined,
    persistProjectPath: () => ({ outcome: 'created' as const, project: projectFixture }),
    getProjectByPath: () => projectFixture,
    ...overrides,
  };
}

function assertProjectServiceError(error: unknown, code: string, statusCode: number): asserts error is AppError {
  assert.ok(error instanceof AppError);
  assert.equal(error.code, code);
  assert.equal(error.statusCode, statusCode);
}

function withProjectRepository(
  replacements: Pick<typeof projectsDb, 'promoteProjectOriginById' | 'getProjectById'>,
  action: () => void,
): void {
  const originalRepository = {
    promoteProjectOriginById: projectsDb.promoteProjectOriginById,
    getProjectById: projectsDb.getProjectById,
  };
  Object.assign(projectsDb, replacements);
  try {
    action();
  } finally {
    Object.assign(projectsDb, originalRepository);
  }
}

test('project registration reports required and invalid paths with their API validation details', async () => {
  const invalidRequests = [
    {
      request: { projectPath: '' },
      dependencies: undefined,
      code: 'PROJECT_PATH_REQUIRED',
      details: undefined,
    },
    {
      request: { projectPath: '/restricted/gajae-dashboard' },
      dependencies: createDependencies({ validatePath: async () => ({ valid: false, error: 'workspace access denied' }) }),
      code: 'INVALID_PROJECT_PATH',
      details: 'workspace access denied',
    },
  ] as const;

  for (const { request, dependencies, code, details } of invalidRequests) {
    await assert.rejects(
      () => createProject(request, dependencies),
      (error: unknown) => {
        assertProjectServiceError(error, code, 400);
        assert.equal(error.details, details);
        return true;
      },
    );
  }
});

test('an already active project is returned as the API-facing conflict detail', async () => {
  await assert.rejects(
    () => createProject(
      { projectPath: projectFixture.project_path },
      createDependencies({ persistProjectPath: () => ({ outcome: 'active_conflict', project: projectFixture }) }),
    ),
    (error: unknown) => {
      assertProjectServiceError(error, 'PROJECT_ALREADY_EXISTS', 409);
      assert.deepEqual(error.details, {
        project: {
          projectId: 'gajae-dashboard',
          path: '/workspaces/gajae/dashboard',
          fullPath: '/workspaces/gajae/dashboard',
          displayName: 'Gajae dashboard',
          customName: 'Gajae dashboard',
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

test('registration derives a directory name and identifies reactivated archived projects', async () => {
  let persistedName: string | null = null;
  const created = await createProject(
    { projectPath: projectFixture.project_path, customName: '' },
    createDependencies({
      persistProjectPath: (_projectPath, name) => {
        persistedName = name;
        return { outcome: 'created', project: { ...projectFixture, custom_project_name: name } };
      },
    }),
  );
  assert.deepEqual(
    { persistedName, outcome: created.outcome, displayName: created.project.displayName },
    { persistedName: 'dashboard', outcome: 'created', displayName: 'dashboard' },
  );

  const reactivated = await createProject(
    { projectPath: projectFixture.project_path },
    createDependencies({
      persistProjectPath: () => ({ outcome: 'reactivated_archived', project: { ...projectFixture, isArchived: 1 } }),
    }),
  );
  assert.deepEqual(
    { outcome: reactivated.outcome, archived: reactivated.project.isArchived },
    { outcome: 'reactivated_archived', archived: true },
  );
});

test('promotion maps auto and legacy rows directly from repository promotion results', () => {
  const candidates = [
    {
      ...projectFixture,
      project_id: 'gajae-watcher-project',
      project_path: '/workspaces/gajae/watcher',
      custom_project_name: 'Watcher import',
      isStarred: 1,
      origin: 'auto' as const,
    },
    {
      ...projectFixture,
      project_id: 'gajae-migrated-project',
      project_path: '/workspaces/gajae/migrated',
      custom_project_name: null,
      isArchived: 1,
    },
  ];
  const promotedIds: string[] = [];

  withProjectRepository(
    {
      promoteProjectOriginById: (projectId) => {
        const candidate = candidates.find((project) => project.project_id === projectId);
        if (!candidate) return null;
        promotedIds.push(projectId);
        return { ...candidate, origin: 'explicit' };
      },
      getProjectById: () => {
        throw new Error('A repository promotion result must be converted directly');
      },
    },
    () => {
      const promotedViews = candidates.map(({ project_id: projectId }) => promoteProjectOrigin(projectId));
      assert.deepEqual(promotedIds, ['gajae-watcher-project', 'gajae-migrated-project']);
      assert.deepEqual(promotedViews, [
        {
          projectId: 'gajae-watcher-project',
          path: '/workspaces/gajae/watcher',
          fullPath: '/workspaces/gajae/watcher',
          displayName: 'Watcher import',
          customName: 'Watcher import',
          origin: 'explicit',
          isArchived: false,
          isStarred: true,
          sessions: [],
          sessionMeta: { hasMore: false, total: 0 },
        },
        {
          projectId: 'gajae-migrated-project',
          path: '/workspaces/gajae/migrated',
          fullPath: '/workspaces/gajae/migrated',
          displayName: 'migrated',
          customName: null,
          origin: 'explicit',
          isArchived: true,
          isStarred: false,
          sessions: [],
          sessionMeta: { hasMore: false, total: 0 },
        },
      ]);
    },
  );
});

test('promotion returns an explicit row and rejects absent or blank identifiers without fallback queries', () => {
  const explicit = {
    ...projectFixture,
    project_id: 'gajae-explicit-project',
    custom_project_name: 'Explicit Gajae project',
    isStarred: 1,
    isArchived: 1,
    origin: 'explicit' as const,
  };
  withProjectRepository(
    {
      promoteProjectOriginById: (projectId) => (projectId === explicit.project_id ? explicit : null),
      getProjectById: (projectId) => {
        if (projectId === explicit.project_id) {
          throw new Error('An explicit promotion must not perform a fallback lookup');
        }
        return null;
      },
    },
    () => {
      assert.deepEqual(promoteProjectOrigin(explicit.project_id), {
        projectId: 'gajae-explicit-project',
        path: '/workspaces/gajae/dashboard',
        fullPath: '/workspaces/gajae/dashboard',
        displayName: 'Explicit Gajae project',
        customName: 'Explicit Gajae project',
        origin: 'explicit',
        isArchived: true,
        isStarred: true,
        sessions: [],
        sessionMeta: { hasMore: false, total: 0 },
      });
      assert.throws(() => promoteProjectOrigin('gajae-unknown-project'), (error: unknown) => {
        assertProjectServiceError(error, 'PROJECT_NOT_FOUND', 404);
        return true;
      });
    },
  );

  withProjectRepository(
    {
      promoteProjectOriginById: () => {
        throw new Error('Blank identifiers must not query the repository');
      },
      getProjectById: () => {
        throw new Error('Blank identifiers must not query the repository');
      },
    },
    () => {
      for (const projectId of ['', '   ']) {
        assert.throws(() => promoteProjectOrigin(projectId), (error: unknown) => {
          assertProjectServiceError(error, 'PROJECT_ID_REQUIRED', 400);
          return true;
        });
      }
    },
  );
});
