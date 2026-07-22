import assert from 'node:assert/strict';
import test from 'node:test';

import { projectsDb } from '@/modules/database/index.js';
import { createProject, promoteProjectOrigin } from '@/modules/projects/services/project-management.service.js';
import { AppError } from '@/shared/utils.js';

const projectRow = {
  project_id: 'project-1',
  project_path: '/workspace/my-project',
  custom_project_name: 'my-project',
  isStarred: 0,
  isArchived: 0,
  origin: 'legacy' as const,
};

test('createProject throws when project path is missing', async () => {
  await assert.rejects(
    async () => createProject({ projectPath: '' }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'PROJECT_PATH_REQUIRED');
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});

test('createProject throws when path validation fails', async () => {
  await assert.rejects(
    async () =>
      createProject(
        { projectPath: '/invalid/path' },
        {
          validatePath: async () => ({ valid: false, error: 'blocked path' }),
          ensureWorkspaceDirectory: async () => undefined,
          persistProjectPath: () => ({ outcome: 'created', project: projectRow }),
          getProjectByPath: () => projectRow,
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'INVALID_PROJECT_PATH');
      assert.equal(error.statusCode, 400);
      assert.equal(error.details, 'blocked path');
      return true;
    },
  );
});

test('createProject throws conflict when active project path already exists', async () => {
  await assert.rejects(
    async () =>
      createProject(
        { projectPath: '/workspace/my-project' },
        {
          validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
          ensureWorkspaceDirectory: async () => undefined,
          persistProjectPath: () => ({ outcome: 'active_conflict', project: projectRow }),
          getProjectByPath: () => projectRow,
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'PROJECT_ALREADY_EXISTS');
      assert.equal(error.statusCode, 409);
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

test('createProject falls back to directory name when custom name is not provided', async () => {
  let capturedCustomName: string | null = null;

  const result = await createProject(
    { projectPath: '/workspace/my-project', customName: '' },
    {
      validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
      ensureWorkspaceDirectory: async () => undefined,
      persistProjectPath: (_projectPath, customName) => {
        capturedCustomName = customName;
        return {
          outcome: 'created',
          project: {
            ...projectRow,
            custom_project_name: customName,
          },
        };
      },
      getProjectByPath: () => projectRow,
    },
  );

  assert.equal(capturedCustomName, 'my-project');
  assert.equal(result.outcome, 'created');
  assert.equal(result.project.displayName, 'my-project');
});

test('createProject returns archived reuse outcome when archived row is reused', async () => {
  const result = await createProject(
    { projectPath: '/workspace/my-project' },
    {
      validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
      ensureWorkspaceDirectory: async () => undefined,
      persistProjectPath: () => ({
        outcome: 'reactivated_archived',
        project: {
          ...projectRow,
          isArchived: 1,
        },
      }),
      getProjectByPath: () => projectRow,
    },
  );

  assert.equal(result.outcome, 'reactivated_archived');
  assert.equal(result.project.isArchived, true);
});
test('promoteProjectOrigin promotes auto and legacy projects while preserving project fields', () => {
  const originalPromoteProjectOriginById = projectsDb.promoteProjectOriginById;
  const originalGetProjectById = projectsDb.getProjectById;
  const rows = [
    {
      project_id: 'auto-project',
      project_path: '/workspace/auto-project',
      custom_project_name: 'Auto project',
      isStarred: 1,
      isArchived: 0,
      origin: 'auto' as const,
    },
    {
      project_id: 'legacy-project',
      project_path: '/workspace/legacy-project',
      custom_project_name: null,
      isStarred: 0,
      isArchived: 1,
      origin: 'legacy' as const,
    },
  ];
  const promotedProjectIds: string[] = [];

  try {
    projectsDb.promoteProjectOriginById = (projectId: string) => {
      const project = rows.find((row) => row.project_id === projectId);
      if (!project) {
        return null;
      }

      promotedProjectIds.push(projectId);
      return { ...project, origin: 'explicit' };
    };
    projectsDb.getProjectById = () => {
      throw new Error('Promotion should return the project row directly');
    };

    for (const row of rows) {
      assert.deepEqual(promoteProjectOrigin(row.project_id), {
        projectId: row.project_id,
        path: row.project_path,
        fullPath: row.project_path,
        displayName: row.custom_project_name ?? 'legacy-project',
        customName: row.custom_project_name,
        origin: 'explicit',
        isArchived: Boolean(row.isArchived),
        isStarred: Boolean(row.isStarred),
        sessions: [],
        sessionMeta: { hasMore: false, total: 0 },
      });
    }

    assert.deepEqual(promotedProjectIds, ['auto-project', 'legacy-project']);
  } finally {
    projectsDb.promoteProjectOriginById = originalPromoteProjectOriginById;
    projectsDb.getProjectById = originalGetProjectById;
  }
});

test('promoteProjectOrigin returns an already-explicit project unchanged', () => {
  const originalPromoteProjectOriginById = projectsDb.promoteProjectOriginById;
  const originalGetProjectById = projectsDb.getProjectById;
  const explicitProject = {
    project_id: 'explicit-project',
    project_path: '/workspace/explicit-project',
    custom_project_name: 'Explicit project',
    isStarred: 1,
    isArchived: 1,
    origin: 'explicit' as const,
  };

  try {
    projectsDb.promoteProjectOriginById = () => explicitProject;
    projectsDb.getProjectById = () => {
      throw new Error('An explicit project should be returned by promotion');
    };

    assert.deepEqual(promoteProjectOrigin(explicitProject.project_id), {
      projectId: explicitProject.project_id,
      path: explicitProject.project_path,
      fullPath: explicitProject.project_path,
      displayName: explicitProject.custom_project_name,
      customName: explicitProject.custom_project_name,
      origin: 'explicit',
      isArchived: true,
      isStarred: true,
      sessions: [],
      sessionMeta: { hasMore: false, total: 0 },
    });
  } finally {
    projectsDb.promoteProjectOriginById = originalPromoteProjectOriginById;
    projectsDb.getProjectById = originalGetProjectById;
  }
});

test('promoteProjectOrigin throws when the project does not exist', () => {
  const originalPromoteProjectOriginById = projectsDb.promoteProjectOriginById;
  const originalGetProjectById = projectsDb.getProjectById;

  try {
    projectsDb.promoteProjectOriginById = () => null;
    projectsDb.getProjectById = () => null;

    assert.throws(
      () => promoteProjectOrigin('missing-project'),
      (error: unknown) =>
        error instanceof AppError
        && error.code === 'PROJECT_NOT_FOUND'
        && error.statusCode === 404,
    );
  } finally {
    projectsDb.promoteProjectOriginById = originalPromoteProjectOriginById;
    projectsDb.getProjectById = originalGetProjectById;
  }
});

test('promoteProjectOrigin rejects blank project IDs', () => {
  const originalPromoteProjectOriginById = projectsDb.promoteProjectOriginById;
  const originalGetProjectById = projectsDb.getProjectById;

  try {
    projectsDb.promoteProjectOriginById = () => {
      throw new Error('Blank project IDs must not reach the repository');
    };
    projectsDb.getProjectById = () => {
      throw new Error('Blank project IDs must not reach the repository');
    };

    for (const projectId of ['', '   ']) {
      assert.throws(
        () => promoteProjectOrigin(projectId),
        (error: unknown) =>
          error instanceof AppError
          && error.code === 'PROJECT_ID_REQUIRED'
          && error.statusCode === 400,
      );
    }
  } finally {
    projectsDb.promoteProjectOriginById = originalPromoteProjectOriginById;
    projectsDb.getProjectById = originalGetProjectById;
  }
});
