import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import spawn from 'cross-spawn';

import { startCloneProject } from '@/modules/projects/services/project-clone.service.js';
import { AppError } from '@/shared/utils.js';

const execFile = promisify(execFileCallback);
type CloneDependencies = NonNullable<Parameters<typeof startCloneProject>[2]>;

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout;
}

async function createBareRepository(root: string, parentDirectory: string): Promise<string> {
  const sourceDirectory = path.join(root, `source-${parentDirectory}`);
  const originDirectory = path.join(root, parentDirectory, 'fixture.git');
  await mkdir(sourceDirectory, { recursive: true });
  await runGit(['init'], sourceDirectory);
  await runGit(['config', 'user.email', 'clone-smoke@example.test'], sourceDirectory);
  await runGit(['config', 'user.name', 'Clone Smoke'], sourceDirectory);
  await writeFile(path.join(sourceDirectory, 'fixture.txt'), `${parentDirectory}\n`);
  await runGit(['add', 'fixture.txt'], sourceDirectory);
  await runGit(['commit', '-m', 'fixture'], sourceDirectory);
  await runGit(['init', '--bare', originDirectory], root);
  await runGit(['remote', 'add', 'origin', originDirectory], sourceDirectory);
  await runGit(['push', 'origin', 'HEAD'], sourceDirectory);
  return pathToFileURL(originDirectory).href;
}

function createDependencies(registeredProjects: Array<Record<string, unknown>>): CloneDependencies {
  return {
    validatePath: async (requestedPath) => ({ valid: true, resolvedPath: requestedPath }),
    ensureDirectory: async (directoryPath) => {
      await mkdir(directoryPath, { recursive: true });
    },
    pathExists: async (targetPath) => {
      try {
        await access(targetPath);
        return true;
      } catch {
        return false;
      }
    },
    removePath: async (targetPath) => rm(targetPath, { recursive: true, force: true }),
    getGithubTokenById: async () => null,
    spawnGitClone: (cloneUrl, clonePath) =>
      spawn('git', ['clone', '--progress', '--', cloneUrl, clonePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }),
    registerProject: async (projectPath, customName) => {
      const project = { projectId: `project-${registeredProjects.length + 1}`, path: projectPath, displayName: customName };
      registeredProjects.push(project);
      return { project };
    },
    logError: () => undefined,
  };
}

test('clone smoke: local bare origin clones, registers, and rejects existing targets', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'gajae-clone-smoke-'));
  try {
    const originUrl = await createBareRepository(temporaryDirectory, 'origin-one');
    const differentOriginUrl = await createBareRepository(temporaryDirectory, 'origin-two');
    const workspacePath = path.join(temporaryDirectory, 'workspace');
    const registeredProjects: Array<Record<string, unknown>> = [];
    const completePayloads: Array<{ project: Record<string, unknown>; message: string }> = [];
    const dependencies = createDependencies(registeredProjects);
    const input = { workspacePath, githubUrl: originUrl, userId: 1 };

    const operation = await startCloneProject(input, {
      onProgress: () => undefined,
      onComplete: (payload) => completePayloads.push(payload),
    }, dependencies);
    await operation.waitForCompletion;

    const clonePath = path.join(workspacePath, 'fixture');
    assert.equal(await readFile(path.join(clonePath, 'fixture.txt'), 'utf8'), 'origin-one\n');
    assert.equal(registeredProjects.length, 1);
    assert.deepEqual(completePayloads, [{
      project: registeredProjects[0],
      message: 'Repository cloned successfully',
    }]);

    for (const githubUrl of [originUrl, differentOriginUrl]) {
      await assert.rejects(
        async () => startCloneProject({ ...input, githubUrl }, { onProgress: () => undefined, onComplete: () => undefined }, dependencies),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, 'CLONE_TARGET_ALREADY_EXISTS');
          assert.equal(error.statusCode, 409);
          return true;
        },
      );
    }
    assert.equal(registeredProjects.length, 1);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
