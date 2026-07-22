import assert from 'node:assert/strict';
import test from 'node:test';

import { api } from '../../../utils/api';

import { createProjectRequest } from './workspaceApi';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

test('createProjectRequest promotes an auto-discovered project opened by the user', async () => {
  const originalCreateProject = api.createProject;
  const originalPromoteProject = api.promoteProject;
  const promotedProjectIds: string[] = [];

  try {
    api.createProject = async () => jsonResponse({
      error: {
        code: 'PROJECT_ALREADY_EXISTS',
        message: 'Project path already exists and is active',
        details: {
          project: {
            projectId: 'auto-project',
            path: '/workspace/project',
            fullPath: '/workspace/project',
            displayName: 'project',
            origin: 'auto',
          },
        },
      },
    }, 409);
    api.promoteProject = async (projectId: string) => {
      promotedProjectIds.push(projectId);
      return jsonResponse({
        success: true,
        project: {
          projectId,
          path: '/workspace/project',
          fullPath: '/workspace/project',
          displayName: 'project',
          origin: 'explicit',
        },
      });
    };

    const project = await createProjectRequest({ path: '/workspace/project' });

    assert.deepEqual(promotedProjectIds, ['auto-project']);
    assert.equal(project?.projectId, 'auto-project');
    assert.equal(project?.origin, 'explicit');
  } finally {
    api.createProject = originalCreateProject;
    api.promoteProject = originalPromoteProject;
  }
});

test('createProjectRequest treats an already-explicit project as an idempotent open', async () => {
  const originalCreateProject = api.createProject;
  const originalPromoteProject = api.promoteProject;
  let promoteCalled = false;

  try {
    api.createProject = async () => jsonResponse({
      error: {
        code: 'PROJECT_ALREADY_EXISTS',
        details: {
          project: {
            projectId: 'explicit-project',
            path: '/workspace/project',
            fullPath: '/workspace/project',
            displayName: 'project',
            origin: 'explicit',
          },
        },
      },
    }, 409);
    api.promoteProject = async () => {
      promoteCalled = true;
      return jsonResponse({ success: true });
    };

    const project = await createProjectRequest({ path: '/workspace/project' });

    assert.equal(promoteCalled, false);
    assert.equal(project?.projectId, 'explicit-project');
    assert.equal(project?.origin, 'explicit');
  } finally {
    api.createProject = originalCreateProject;
    api.promoteProject = originalPromoteProject;
  }
});
