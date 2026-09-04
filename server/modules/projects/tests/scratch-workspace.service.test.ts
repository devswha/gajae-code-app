import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ProjectApiView } from '@/modules/projects/services/project-management.service.js';
import {
  SCRATCH_WORKSPACE_NAME,
  scratchWorkspaceSteps,
  startScratchWorkspace,
  type ScratchWorkspaceDependencies,
} from '@/modules/projects/services/scratch-workspace.service.js';
import { AppError } from '@/shared/utils.js';

const projectView = (fullPath: string): ProjectApiView => ({
  projectId: 'scratch',
  path: fullPath,
  fullPath,
  displayName: SCRATCH_WORKSPACE_NAME,
  customName: SCRATCH_WORKSPACE_NAME,
  origin: 'explicit',
  isArchived: false,
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
});

const exists = (target: string) => access(target).then(() => true, () => false);

/*
 * The production git and README steps run against a temp directory. Only the
 * project registration is replaced: like the real one it validates nothing
 * here, creates the folder and answers with the project view, and it records
 * what it was asked to register.
 */
async function withScratch(
  action: (dependencies: ScratchWorkspaceDependencies, registered: Array<[string, string]>) => Promise<void>,
  overrides: Partial<ScratchWorkspaceDependencies> = {},
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'scratch-workspace-'));
  const registered: Array<[string, string]> = [];
  try {
    await action({
      ...scratchWorkspaceSteps,
      scratchPath: path.join(root, 'gajae-scratch'),
      registerProject: async (directoryPath, name) => {
        registered.push([directoryPath, name]);
        await mkdir(directoryPath, { recursive: true });
        return projectView(directoryPath);
      },
      ...overrides,
    }, registered);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a first start registers Scratch, then makes the folder a git repository with a README', async () => {
  await withScratch(async (dependencies, registered) => {
    const result = await startScratchWorkspace(dependencies);

    assert.equal(result.outcome, 'created');
    assert.equal(result.git, true);
    assert.equal(result.project.fullPath, dependencies.scratchPath);
    assert.deepEqual(registered, [[dependencies.scratchPath, SCRATCH_WORKSPACE_NAME]]);
    assert.equal(await exists(path.join(dependencies.scratchPath, '.git')), true, 'git init ran');
    assert.match(await readFile(path.join(dependencies.scratchPath, 'README.md'), 'utf8'), /Scratch workspace/);
  });
});

test('a second start is idempotent: the folder, its files and the repository are left alone', async () => {
  await withScratch(async (dependencies, registered) => {
    await startScratchWorkspace(dependencies);
    await writeFile(path.join(dependencies.scratchPath, 'README.md'), 'edited by the user\n');
    await writeFile(path.join(dependencies.scratchPath, 'notes.txt'), 'kept\n');

    const again = await startScratchWorkspace(dependencies);

    assert.equal(again.outcome, 'existing');
    assert.equal(again.git, true);
    assert.equal(await readFile(path.join(dependencies.scratchPath, 'README.md'), 'utf8'), 'edited by the user\n', 'the README is never rewritten');
    assert.equal(await exists(path.join(dependencies.scratchPath, 'notes.txt')), true);
    assert.equal(registered.length, 2, 'registration decides idempotency itself and is asked each time');
  });
});

test('a machine without git still gets a usable scratch project', async () => {
  await withScratch(async (dependencies) => {
    const result = await startScratchWorkspace(dependencies);
    assert.equal(result.outcome, 'created');
    assert.equal(result.git, false);
    assert.equal(await exists(path.join(dependencies.scratchPath, '.git')), false);
    assert.equal(await exists(path.join(dependencies.scratchPath, 'README.md')), true);
  }, { initializeRepository: async () => false });
});

test('a path the workspace gate rejects leaves nothing on disk', async () => {
  await withScratch(async (dependencies) => {
    await assert.rejects(
      () => startScratchWorkspace(dependencies),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_PROJECT_PATH',
    );
    assert.equal(await exists(dependencies.scratchPath), false, 'registration runs before any filesystem step');
  }, {
    registerProject: async () => {
      throw new AppError('Invalid project path', { code: 'INVALID_PROJECT_PATH', statusCode: 400 });
    },
  });
});
