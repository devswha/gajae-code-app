import { strict as assert } from 'node:assert';
import { EventEmitter as CloneProcessEmitter } from 'node:events';
import { basename as directoryName } from 'node:path';
import { PassThrough as CloneOutputStream } from 'node:stream';
import { test } from 'node:test';

import { startCloneProject as beginProjectClone } from '@/modules/projects/services/project-clone.service.js';
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
    removePath: async () => undefined,
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
  const clone = await beginProjectClone(cloneInput({ githubUrl: 'https://github.com/gajae-app/dashboard.git' }),
  events.handlers,
  cloneDependencies({
    spawnGitClone: () => cloneProcess,
    registerProject: async (destination, name) => {
      registeredDestinations.push({ destination, name });
      return { project: { projectId: 'gajae-dashboard', path: destination } };
    },
  }),);

  cloneProcess.emit('close', 0);
  await clone.waitForCompletion;

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
