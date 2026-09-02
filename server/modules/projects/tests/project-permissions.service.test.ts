import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseGjcRunPermissions } from '@/gjc-engine.js';
import { closeConnection, initializeDatabase, projectPermissionsDb, projectsDb } from '@/modules/database/index.js';
import {
  getProjectPermissions,
  grantProjectAlwaysAllow,
  listConfiguredProjectPermissions,
  resetProjectPermissions,
  resolveRunPermissions,
  revokeProjectAlwaysAllow,
  updateProjectPermissionMode,
} from '@/modules/projects/services/project-permissions.service.js';
import { AppError } from '@/shared/utils.js';

async function withDatabase(action: () => void | Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'project-permissions-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'app.sqlite');
  try {
    await initializeDatabase();
    await action();
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

function project(projectPath: string): { id: string; path: string } {
  const created = projectsDb.createProjectPath(projectPath);
  assert.ok(created.project);
  return { id: created.project.project_id, path: created.project.project_path };
}

const code = (error: unknown) => (error instanceof AppError ? error.code : undefined);

test('a project starts in ask mode with an empty allow-list and no stored row', async () => {
  await withDatabase(() => {
    const alpha = project('/work/alpha');
    assert.deepEqual(getProjectPermissions(alpha.id), {
      projectId: alpha.id, projectPath: alpha.path, mode: 'ask', allowAlways: [], bypassAcknowledged: false, updatedAt: null,
    });
    assert.deepEqual(listConfiguredProjectPermissions(), []);
    assert.deepEqual(resolveRunPermissions(alpha.path), { mode: 'ask', allowAlways: [] });
    assert.deepEqual(resolveRunPermissions(null), { mode: 'ask', allowAlways: [] });
  });
});

test('every policy block the app emits is one the worker accepts', async () => {
  await withDatabase(() => {
    const alpha = project('/work/alpha');
    const beta = project('/work/beta');
    updateProjectPermissionMode(beta.id, { mode: 'auto_edits' });
    grantProjectAlwaysAllow(beta.path, 'bash');
    grantProjectAlwaysAllow(beta.path, 'todo_write');

    // The block crosses the worker protocol as JSON, so the round trip is what
    // the worker-side validator actually sees.
    for (const projectPath of [null, undefined, '/work/never-registered', alpha.path, beta.path]) {
      const emitted = JSON.parse(JSON.stringify(resolveRunPermissions(projectPath))) as unknown;
      assert.deepEqual(parseGjcRunPermissions(emitted), resolveRunPermissions(projectPath), String(projectPath));
    }
    assert.deepEqual(resolveRunPermissions(beta.path), { mode: 'auto_edits', allowAlways: ['bash', 'todo_write'] });
  });
});

test('bypass needs the warning acknowledged once per project', async () => {
  await withDatabase(() => {
    const alpha = project('/work/alpha');
    try {
      updateProjectPermissionMode(alpha.id, { mode: 'bypass' });
      assert.fail('bypass without acknowledgement must be refused');
    } catch (error) {
      assert.equal(code(error), 'BYPASS_ACKNOWLEDGEMENT_REQUIRED');
    }

    const enabled = updateProjectPermissionMode(alpha.id, { mode: 'bypass', acknowledgeBypass: true });
    assert.equal(enabled.mode, 'bypass');
    assert.equal(enabled.bypassAcknowledged, true);
    assert.deepEqual(resolveRunPermissions(alpha.path), { mode: 'bypass', allowAlways: [] });

    // Switching away and back needs no second warning.
    assert.equal(updateProjectPermissionMode(alpha.id, { mode: 'ask' }).mode, 'ask');
    assert.equal(updateProjectPermissionMode(alpha.id, { mode: 'bypass' }).mode, 'bypass');
  });
});

test('modes are validated and unknown projects are refused', async () => {
  await withDatabase(() => {
    const alpha = project('/work/alpha');
    try {
      updateProjectPermissionMode(alpha.id, { mode: 'default' });
      assert.fail('an unknown mode must be refused');
    } catch (error) {
      assert.equal(code(error), 'INVALID_PERMISSION_MODE');
    }
    try {
      getProjectPermissions('missing');
      assert.fail('an unknown project must be refused');
    } catch (error) {
      assert.equal(code(error), 'PROJECT_NOT_FOUND');
    }
  });
});

test('always-allow grants are per project, revocable, and part of the run policy', async () => {
  await withDatabase(() => {
    const alpha = project('/work/alpha');
    const beta = project('/work/beta');

    assert.ok(grantProjectAlwaysAllow(alpha.path, 'bash'));
    assert.ok(grantProjectAlwaysAllow(alpha.path, 'eval'));
    assert.ok(grantProjectAlwaysAllow(alpha.path, 'bash'), 'a repeated grant is idempotent');
    assert.equal(grantProjectAlwaysAllow(alpha.path, 'Rm -Rf'), null, 'only runtime tool names are stored');
    assert.equal(grantProjectAlwaysAllow('/work/nowhere', 'bash'), null, 'an unregistered project cannot hold a policy');

    assert.deepEqual(getProjectPermissions(alpha.id).allowAlways, ['bash', 'eval']);
    assert.deepEqual(getProjectPermissions(beta.id).allowAlways, [], 'the grant never leaks to another project');
    assert.deepEqual(resolveRunPermissions(alpha.path), { mode: 'ask', allowAlways: ['bash', 'eval'] });

    assert.deepEqual(revokeProjectAlwaysAllow(alpha.id, 'bash').allowAlways, ['eval']);
    try {
      revokeProjectAlwaysAllow(alpha.id, 'not a tool');
      assert.fail('a malformed tool name must be refused');
    } catch (error) {
      assert.equal(code(error), 'INVALID_TOOL_NAME');
    }

    assert.equal(listConfiguredProjectPermissions().length, 1);
    const reset = resetProjectPermissions(alpha.id);
    assert.deepEqual([reset.mode, reset.allowAlways], ['ask', []]);
    assert.deepEqual(listConfiguredProjectPermissions(), [], 'a reset project leaves no row behind');
  });
});

test('a policy that returns to the default is deleted rather than stored', async () => {
  await withDatabase(() => {
    const alpha = project('/work/alpha');
    updateProjectPermissionMode(alpha.id, { mode: 'auto_edits' });
    assert.equal(projectPermissionsDb.listConfigured().length, 1);
    updateProjectPermissionMode(alpha.id, { mode: 'ask' });
    assert.equal(projectPermissionsDb.listConfigured().length, 0);
  });
});

test('deleting a project removes its policy', async () => {
  await withDatabase(() => {
    const alpha = project('/work/alpha');
    grantProjectAlwaysAllow(alpha.path, 'bash');
    projectsDb.deleteProjectById(alpha.id);
    assert.deepEqual(projectPermissionsDb.listConfigured(), []);
  });
});
