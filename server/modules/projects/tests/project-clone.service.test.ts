import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { startCloneProject } from '@/modules/projects/services/project-clone.service.js';
import { AppError } from '@/shared/utils.js';

type CloneDependencies = NonNullable<Parameters<typeof startCloneProject>[2]>;

function cloneRequest(overrides: Partial<Parameters<typeof startCloneProject>[0]> = {}) {
  return {
    workspacePath: '/workspace/root',
    githubUrl: 'https://github.com/example/repo',
    userId: 1,
    ...overrides,
  };
}

function eventSink() {
  const progress: string[] = [];
  let completed: { project: Record<string, unknown>; message: string } | undefined;
  return {
    handlers: {
      onProgress: (message: string) => progress.push(message),
      onComplete: (payload: { project: Record<string, unknown>; message: string }) => {
        completed = payload;
      },
    },
    progress,
    completed: () => completed,
  };
}

function dependencies(overrides: Partial<CloneDependencies> = {}): CloneDependencies {
  return {
    validatePath: async () => ({ valid: true, resolvedPath: '/workspace/root' }),
    ensureDirectory: async () => undefined,
    pathExists: async () => false,
    removePath: async () => undefined,
    getGithubTokenById: async () => ({ github_token: 'token-value' }),
    spawnGitClone: () => {
      throw new Error('A clone process is required for this scenario');
    },
    registerProject: async () => ({ project: { projectId: 'project-1' } }),
    logError: () => undefined,
    ...overrides,
  };
}

function childProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit('close', null);
  return child;
}

async function expectCloneInputError(input: Partial<Parameters<typeof startCloneProject>[0]>, code: string) {
  const sink = eventSink();
  await assert.rejects(
    () => startCloneProject(cloneRequest(input), sink.handlers, dependencies()),
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

test('clone startup requires a workspace and repository URL that are not git options', async () => {
  await expectCloneInputError({ workspacePath: '' }, 'WORKSPACE_PATH_REQUIRED');
  await expectCloneInputError({ githubUrl: '' }, 'GITHUB_URL_REQUIRED');
  await expectCloneInputError({ githubUrl: '--upload-pack=malicious' }, 'INVALID_GITHUB_URL');
});

test('clone startup refuses a selected token that no longer belongs to the user', async () => {
  const sink = eventSink();
  await assert.rejects(
    () =>
      startCloneProject(
        cloneRequest({ githubTokenId: 12 }),
        sink.handlers,
        dependencies({ getGithubTokenById: async () => null }),
      ),
    (error: unknown) => error instanceof AppError && error.code === 'GITHUB_TOKEN_NOT_FOUND',
  );
});

test('a successful clone reports its repository name and registers its destination', async () => {
  const child = childProcess();
  const sink = eventSink();
  const registered: Array<{ destination: string; name: string }> = [];
  const operation = await startCloneProject(
    cloneRequest({ githubUrl: 'https://github.com/example/repo.git' }),
    sink.handlers,
    dependencies({
      spawnGitClone: () => child,
      registerProject: async (destination, name) => {
        registered.push({ destination, name });
        return { project: { projectId: 'project-1', path: destination } };
      },
    }),
  );

  child.emit('close', 0);
  await operation.waitForCompletion;

  assert.deepEqual(registered.map(({ name }) => name), ['repo']);
  assert.deepEqual(registered.map(({ destination }) => path.basename(destination)), ['repo']);
  assert.ok(sink.progress.includes("Cloning into 'repo'..."));
  assert.deepEqual(sink.completed(), {
    project: { projectId: 'project-1', path: registered[0].destination },
    message: 'Repository cloned successfully',
  });
});
