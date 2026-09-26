import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateWorkspacePath, workspacesRoot } from '@/shared/utils.js';

/*
 * This decides what a project, a session or a background job uses as its
 * working directory. Like the GJC CLI, which runs in whatever directory it is
 * started in, any directory on the machine is accepted; the answer is its
 * canonical path. WORKSPACES_ROOT is only where browsing starts.
 */

async function inWorkspaceRoot(action: (root: string) => Promise<void>): Promise<void> {
  const previous = process.env.WORKSPACES_ROOT;
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'workspace-path-')));
  process.env.WORKSPACES_ROOT = root;
  try {
    await action(root);
  } finally {
    if (previous === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test('the workspace root follows the environment instead of the value at import time', async () => {
  await inWorkspaceRoot(async (root) => {
    assert.equal(workspacesRoot(), root);
  });
});

test('a directory outside the workspace root is accepted', async () => {
  await inWorkspaceRoot(async () => {
    const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'workspace-outside-')));
    try {
      assert.deepEqual(await validateWorkspacePath(outside), { valid: true, resolvedPath: outside });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('system directories and the filesystem root are accepted like any other directory', async () => {
  await inWorkspaceRoot(async () => {
    for (const candidate of [path.parse(process.cwd()).root, await realpath(tmpdir())]) {
      const result = await validateWorkspacePath(candidate);
      assert.equal(result.valid, true, `${candidate}: ${result.error}`);
      assert.equal(result.resolvedPath, candidate);
    }
  });
});

test('a symlinked directory resolves to its target wherever that target lives', async () => {
  await inWorkspaceRoot(async (root) => {
    const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'workspace-target-')));
    try {
      const link = path.join(root, 'linked');
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      assert.deepEqual(await validateWorkspacePath(link), { valid: true, resolvedPath: outside });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('a directory that does not exist yet resolves under its canonical parent', async () => {
  // Project creation provisions the directory after resolving it.
  await inWorkspaceRoot(async (root) => {
    await mkdir(path.join(root, 'parent'));
    assert.deepEqual(
      await validateWorkspacePath(path.join(root, 'parent', 'project')),
      { valid: true, resolvedPath: path.join(root, 'parent', 'project') },
    );
  });
});

test('an empty path is refused', async () => {
  for (const candidate of ['', '   ']) {
    assert.deepEqual(await validateWorkspacePath(candidate), { valid: false, error: 'Workspace path is required' });
  }
});
