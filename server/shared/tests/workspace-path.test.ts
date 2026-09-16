import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateWorkspacePath, validateWorkspacePathSync, workspacesRoot } from '@/shared/utils.js';

/*
 * This gate decides what a project, a session, a background job and a terminal
 * may use as a working directory. Everything below is about the two questions
 * it answers: is the path inside the tree this deployment owns, and is it a
 * system directory nobody should adopt as a workspace.
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

test('a path outside the workspace root is refused, sync and async alike', async () => {
  await inWorkspaceRoot(async () => {
    const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'workspace-outside-')));
    try {
      const asynchronous = await validateWorkspacePath(outside);
      assert.equal(asynchronous.valid, false);
      assert.match(asynchronous.error ?? '', /workspace root/);
      assert.equal(validateWorkspacePathSync(outside).valid, false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('the filesystem root is never a workspace', async () => {
  await inWorkspaceRoot(async () => {
    const filesystemRoot = path.parse(process.cwd()).root;
    assert.equal((await validateWorkspacePath(filesystemRoot)).valid, false);
    assert.equal(validateWorkspacePathSync(filesystemRoot).valid, false);
  });
});

test('a directory inside the configured root is accepted even below a system directory', async () => {
  // The forbidden list stops a default-rooted install from adopting /tmp or
  // /etc. A deployment that points WORKSPACES_ROOT at a tree underneath one of
  // them - a packaged smoke run, a QA home, this test - has already chosen it.
  await inWorkspaceRoot(async (root) => {
    const project = path.join(root, 'project');
    const asynchronous = await validateWorkspacePath(project);
    assert.equal(asynchronous.valid, true, asynchronous.error);
    assert.equal(asynchronous.resolvedPath, project);
  });
});

test('an explicit root does not make the exact system directories usable', async () => {
  const previous = process.env.WORKSPACES_ROOT;
  process.env.WORKSPACES_ROOT = '/';
  try {
    for (const candidate of ['/', '/etc']) {
      const result = await validateWorkspacePath(candidate);
      assert.equal(result.valid, false, candidate);
    }
  } finally {
    if (previous === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = previous;
  }
});
