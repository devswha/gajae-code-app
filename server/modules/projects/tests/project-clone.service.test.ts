import { strict as assert } from 'node:assert';
import { EventEmitter as CloneProcessEmitter } from 'node:events';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename as directoryName, dirname, join } from 'node:path';
import { PassThrough as CloneOutputStream } from 'node:stream';
import { test } from 'node:test';

import { createCloneWorkspace, startCloneProject as beginProjectClone } from '@/modules/projects/services/project-clone.service.js';
import { AppError as ProjectCloneError } from '@/shared/utils.js';

type CloneDependencies = NonNullable<Parameters<typeof beginProjectClone>[2]>;

function cloneInput(overrides: Partial<Parameters<typeof beginProjectClone>[0]> = {}) {
  return {
    workspacePath: '/workspaces/gajae/imports',
    githubUrl: 'https://github.com/gajae-app/example-project',
    userId: 42,
    ...overrides,
  };
}

function cloneDependencies(overrides: Partial<CloneDependencies> = {}): CloneDependencies {
  return {
    validatePath: async () => ({ valid: true, resolvedPath: '/workspaces/gajae/imports' }),
    ensureDirectory: async () => undefined,
    pathExists: async () => false,
    createCloneWorkspace: async (destination) => ({ path: `${destination}.partial`, publish: async () => undefined, cleanup: async () => undefined }),
    getGithubTokenById: async () => ({ github_token: 'gajae-token' }),
    spawnGitClone: () => {
      throw new Error('This scenario must provide a clone process');
    },
    registerProject: async () => ({ project: { projectId: 'gajae-imported-project' } }),
    logError: () => undefined,
    ...overrides,
  };
}

function createCloneProcess() {
  const process = new CloneProcessEmitter() as CloneProcessEmitter & {
    stdout: CloneOutputStream;
    stderr: CloneOutputStream;
    kill: () => void;
  };
  process.stdout = new CloneOutputStream();
  process.stderr = new CloneOutputStream();
  process.kill = () => process.emit('close', null);
  return process;
}

function createCloneEvents() {
  const progressMessages: string[] = [];
  let completion: { project: Record<string, unknown>; message: string } | undefined;
  return {
    handlers: {
      onProgress: (message: string) => progressMessages.push(message),
      onComplete: (payload: { project: Record<string, unknown>; message: string }) => {
        completion = payload;
      },
    },
    progressMessages,
    getCompletion: () => completion,
  };
}

async function assertCloneRejection(
  input: Partial<Parameters<typeof beginProjectClone>[0]>,
  code: string,
): Promise<void> {
  const events = createCloneEvents();
  await assert.rejects(
    () => beginProjectClone(cloneInput(input), events.handlers, cloneDependencies()),
    (error: unknown) => error instanceof ProjectCloneError && error.code === code,
  );
}

test('clone requests require a workspace and a repository URL that cannot be interpreted as git flags', async () => {
  const invalidRequests = [
    [{ workspacePath: '' }, 'WORKSPACE_PATH_REQUIRED'],
    [{ githubUrl: '' }, 'GITHUB_URL_REQUIRED'],
    [{ githubUrl: '--upload-pack=malicious' }, 'INVALID_GITHUB_URL'],
  ] as const;

  for (const [input, code] of invalidRequests) {
    await assertCloneRejection(input, code);
  }
});

test('a user-selected token must still belong to that user when cloning starts', async () => {
  const events = createCloneEvents();
  await assert.rejects(
    () => beginProjectClone(cloneInput({ githubTokenId: 42 }),
    events.handlers,
    cloneDependencies({ getGithubTokenById: async () => null }),),
    (error: unknown) => error instanceof ProjectCloneError && error.code === 'GITHUB_TOKEN_NOT_FOUND',
  );
});

test('a completed clone registers its derived destination and reports the completion contract', async () => {
  const cloneProcess = createCloneProcess();
  const events = createCloneEvents();
  const registeredDestinations: Array<{ destination: string; name: string }> = [];
  const lifecycle: string[] = [];
  const clone = await beginProjectClone(cloneInput({ githubUrl: 'https://github.com/gajae-app/dashboard.git' }),
  events.handlers,
  cloneDependencies({
    createCloneWorkspace: async (destination) => ({
      path: `${destination}.partial`,
      publish: async () => { lifecycle.push('publish'); },
      cleanup: async () => { lifecycle.push('cleanup'); },
    }),
    spawnGitClone: (_url, destination) => {
      assert.equal(destination, '/workspaces/gajae/imports/dashboard.partial');
      return cloneProcess;
    },
    registerProject: async (destination, name) => {
      lifecycle.push('register');
      registeredDestinations.push({ destination, name });
      return { project: { projectId: 'gajae-dashboard', path: destination } };
    },
  }),);

  cloneProcess.emit('close', 0);
  await clone.waitForCompletion;
  assert.deepEqual(lifecycle, ['publish', 'register', 'cleanup']);

  assert.deepEqual(
    registeredDestinations.map(({ name, destination }) => ({ name, destination: directoryName(destination) })),
    [{ name: 'dashboard', destination: 'dashboard' }],
  );
  assert.ok(events.progressMessages.includes("Cloning into 'dashboard'..."));
  assert.deepEqual(events.getCompletion(), {
    project: { projectId: 'gajae-dashboard', path: registeredDestinations[0].destination },
    message: 'Repository cloned successfully',
  });
});

test('a synchronous clone spawn failure releases only its staging workspace', async () => {
  let cleaned = 0;
  const failure = new Error('fixture spawn failed');
  await assert.rejects(beginProjectClone(cloneInput(), createCloneEvents().handlers, cloneDependencies({
    createCloneWorkspace: async () => ({ path: '/private/staging/checkout', publish: async () => assert.fail('failed spawn cannot publish'), cleanup: async () => { cleaned += 1; } }),
    spawnGitClone: () => { throw failure; },
  })), (error: unknown) => error === failure);
  assert.equal(cleaned, 1);
});

test('a process error followed by close cannot publish or clean up twice', async () => {
  const cloneProcess = createCloneProcess();
  let cleaned = 0;
  const clone = await beginProjectClone(cloneInput(), createCloneEvents().handlers, cloneDependencies({
    createCloneWorkspace: async () => ({ path: '/private/staging/checkout', publish: async () => assert.fail('failed process cannot publish'), cleanup: async () => { cleaned += 1; } }),
    spawnGitClone: () => cloneProcess,
    registerProject: async () => { assert.fail('failed process cannot register'); },
  }));
  const rejected = assert.rejects(clone.waitForCompletion, (error: unknown) => error instanceof ProjectCloneError && error.code === 'GIT_NOT_FOUND');
  cloneProcess.emit('error', Object.assign(new Error('missing git'), { code: 'ENOENT' }));
  cloneProcess.emit('close', 0);
  await rejected;
  assert.equal(cleaned, 1);
});

test('cancelled clones discard staging without publishing a destination', async () => {
  const cloneProcess = createCloneProcess();
  let cleaned = 0;
  const clone = await beginProjectClone(cloneInput(), createCloneEvents().handlers, cloneDependencies({
    createCloneWorkspace: async () => ({ path: '/private/staging/checkout', publish: async () => assert.fail('cancelled clone cannot publish'), cleanup: async () => { cleaned += 1; } }),
    spawnGitClone: () => cloneProcess,
  }));
  const rejected = assert.rejects(clone.waitForCompletion, (error: unknown) => error instanceof ProjectCloneError && error.code === 'GIT_CLONE_FAILED');
  clone.cancel();
  await rejected;
  assert.equal(cleaned, 1);
});

test('publication conflicts keep their 409 status and never register the losing checkout', async () => {
  const cloneProcess = createCloneProcess();
  let cleaned = 0;
  const conflict = new ProjectCloneError('destination already claimed', { code: 'CLONE_TARGET_ALREADY_EXISTS', statusCode: 409 });
  const clone = await beginProjectClone(cloneInput(), createCloneEvents().handlers, cloneDependencies({
    createCloneWorkspace: async () => ({ path: '/private/staging/checkout', publish: async () => { throw conflict; }, cleanup: async () => { cleaned += 1; } }),
    spawnGitClone: () => cloneProcess,
    registerProject: async () => { assert.fail('losing checkout cannot register'); },
  }));
  cloneProcess.emit('close', 0);
  await assert.rejects(clone.waitForCompletion, (error: unknown) => error === conflict);
  assert.equal(cleaned, 1);
});

test('filesystem publication preserves a concurrently created directory or symlink', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gajae-clone-ownership-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const kind of ['directory', 'symlink'] as const) {
    const destination = join(root, kind);
    const workspace = await createCloneWorkspace(destination);
    await mkdir(workspace.path);
    await writeFile(join(workspace.path, 'clone.txt'), 'staged clone');
    const existing = kind === 'directory' ? destination : join(root, 'user-directory');
    await mkdir(existing);
    await writeFile(join(existing, 'user.txt'), 'preserve user data');
    if (kind === 'symlink') await symlink(existing, destination, process.platform === 'win32' ? 'junction' : 'dir');
    const before = await lstat(destination);
    await assert.rejects(workspace.publish(), (error: unknown) => error instanceof ProjectCloneError && error.statusCode === 409);
    await workspace.cleanup();
    assert.equal((await lstat(destination)).ino, before.ino);
    assert.equal(await readFile(join(existing, 'user.txt'), 'utf8'), 'preserve user data');
    await assert.rejects(lstat(dirname(workspace.path)), { code: 'ENOENT' });
  }
});

test('a failed publication removes its empty reservation and private staging only', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gajae-clone-publish-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = await createCloneWorkspace(join(root, 'destination'));
  // A missing checkout makes the atomic rename fail after mkdir succeeds.
  await assert.rejects(workspace.publish(), { code: 'ENOENT' });
  await workspace.cleanup();
  assert.deepEqual(await readdir(root), []);
});
