import assert from 'node:assert/strict';
import { execFile as execFileCallback, fork } from 'node:child_process';
import { access, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import spawn from 'cross-spawn';

import { createCloneWorkspace, startCloneProject } from '@/modules/projects/services/project-clone.service.js';
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
    createCloneWorkspace,
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

test('clone smoke: a missing origin cleans up and permits a later retry', { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-clone-retry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspacePath = path.join(root, 'workspace with 한글');
  const registered: Array<Record<string, unknown>> = [];
  const completed: unknown[] = [];
  const dependencies = createDependencies(registered);
  const handlers = { onProgress() {}, onComplete: (payload: unknown) => { completed.push(payload); } };
  const missing = await startCloneProject({ workspacePath, githubUrl: pathToFileURL(path.join(root, 'missing', 'fixture.git')).href, userId: 1 }, handlers, dependencies);
  await assert.rejects(missing.waitForCompletion, (error: unknown) => error instanceof AppError && error.code === 'GIT_CLONE_FAILED');
  assert.equal(await dependencies.pathExists(path.join(workspacePath, 'fixture')), false);
  assert.equal(registered.length, 0);
  assert.equal(completed.length, 0);

  const githubUrl = await createBareRepository(root, 'origin with 한글');
  const retried = await startCloneProject({ workspacePath, githubUrl, userId: 1 }, handlers, dependencies);
  await retried.waitForCompletion;
  assert.equal(await readFile(path.join(workspacePath, 'fixture', 'fixture.txt'), 'utf8'), 'origin with 한글\n');
  assert.equal(registered.length, 1);
  assert.equal(completed.length, 1);
});

test('clone smoke: registration failure preserves the completed checkout', { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-clone-register-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const githubUrl = await createBareRepository(root, 'origin');
  const workspacePath = path.join(root, 'workspace');
  const dependencies = createDependencies([]);
  dependencies.registerProject = async () => { throw new Error('fixture registration unavailable'); };
  const operation = await startCloneProject({ workspacePath, githubUrl, userId: 1 }, {
    onProgress() {},
    onComplete() { assert.fail('registration failed and must not announce success'); },
  }, dependencies);
  await assert.rejects(operation.waitForCompletion, (error: unknown) => error instanceof AppError && error.code === 'CLONE_PROJECT_REGISTRATION_FAILED');
  assert.equal(await readFile(path.join(workspacePath, 'fixture', 'fixture.txt'), 'utf8'), 'origin\n');
  assert.equal((await runGit(['rev-parse', '--is-inside-work-tree'], path.join(workspacePath, 'fixture'))).trim(), 'true');
});

test('clone smoke: a losing clone preserves a checkout created after target preflight', { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-clone-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const githubUrl = await createBareRepository(root, 'origin');
  const workspacePath = path.join(root, 'workspace');
  const destination = path.join(workspacePath, 'fixture');
  const registered: Array<Record<string, unknown>> = [];
  const dependencies = createDependencies(registered);
  const pathExists = dependencies.pathExists;
  let injected = false;
  dependencies.pathExists = async (target) => {
    const existed = await pathExists(target);
    if (!existed && target === destination && !injected) {
      injected = true;
      // A different request wins after this request's existence check. Both
      // checkouts use real Git; only the scheduling of the race is controlled.
      await runGit(['clone', '--', githubUrl, target], root);
      await writeFile(path.join(target, 'user-change.txt'), 'preserve the winning checkout\n');
    }
    return existed;
  };
  await assert.rejects(async () => {
    const operation = await startCloneProject({ workspacePath, githubUrl, userId: 1 }, { onProgress() {}, onComplete() {} }, dependencies);
    await operation.waitForCompletion;
  }, (error: unknown) => error instanceof AppError);
  assert.equal(registered.length, 0);
  assert.equal(await readFile(path.join(destination, 'fixture.txt'), 'utf8'), 'origin\n');
  assert.equal(await readFile(path.join(destination, 'user-change.txt'), 'utf8'), 'preserve the winning checkout\n');
});

test('clone smoke: competing server processes publish one real Git checkout without losing user files', { timeout: 15_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-clone-process-race-'));
  const contenders: Array<ReturnType<typeof startContender>> = [];
  t.after(async () => {
    for (const contender of contenders) {
      if (contender.child.exitCode === null && contender.child.signalCode === null) contender.child.kill('SIGKILL');
    }
    await Promise.all(contenders.map((contender) => contender.closed));
    await rm(root, { recursive: true, force: true });
  });
  const githubUrl = await createBareRepository(root, 'origin');
  const workspacePath = path.join(root, 'workspace');
  await mkdir(workspacePath);
  const script = path.join(root, 'clone-contender.mjs');
  const serviceUrl = new URL('../modules/projects/services/project-clone.service.ts', import.meta.url).href;
  await writeFile(script, `
    import { access, mkdir, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    import { spawn } from 'node:child_process';
    import { createCloneWorkspace, startCloneProject } from ${JSON.stringify(serviceUrl)};
    const [workspacePath, githubUrl] = process.argv.slice(2);
    try {
      const operation = await startCloneProject({ workspacePath, githubUrl, userId: 1 }, { onProgress() {}, onComplete() {} }, {
        validatePath: async requestedPath => ({ valid: true, resolvedPath: requestedPath }),
        ensureDirectory: async directory => { await mkdir(directory, { recursive: true }); },
        pathExists: async target => {
          const existed = await access(target).then(() => true, () => false);
          const released = new Promise(resolve => process.once('message', resolve));
          process.send({ kind: 'preflight', existed });
          await released;
          return existed;
        },
        createCloneWorkspace,
        getGithubTokenById: async () => null,
        spawnGitClone: (url, target) => spawn('git', ['clone', '--progress', '--', url, target], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }),
        registerProject: async target => {
          await writeFile(join(target, 'user-change.txt'), 'winning checkout survives\\n');
          return { project: { path: target } };
        },
        logError: (message, error) => console.error(message, error),
      });
      await operation.waitForCompletion;
      process.send({ kind: 'result', status: 'fulfilled' }, () => process.disconnect());
    } catch (error) {
      process.send({ kind: 'result', status: 'rejected', code: error.code, message: error.message }, () => process.disconnect());
    }
  `);

  function startContender(index: number) {
    const child = fork(script, [workspacePath, githubUrl], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, DATABASE_PATH: path.join(root, `contender-${index}.db`) },
      silent: true,
    });
    let diagnostics = '';
    child.stderr?.on('data', (chunk) => { diagnostics = (diagnostics + String(chunk)).slice(-8_192); });
    child.stdout?.resume();
    let readyResolve!: (existed: boolean) => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<boolean>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    let resultResolve!: (value: { status: string; code?: string }) => void;
    let resultReject!: (error: Error) => void;
    const result = new Promise<{ status: string; code?: string }>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
    // Install rejection handlers before either process can fail during startup.
    void ready.catch(() => {});
    void result.catch(() => {});
    let receivedResult = false;
    child.on('message', (raw) => {
      const message = raw as { kind: string; existed: boolean; status: string; code?: string };
      if (message.kind === 'preflight') readyResolve(message.existed);
      if (message.kind === 'result') { receivedResult = true; resultResolve(message); }
    });
    child.once('error', (error) => { readyReject(error); resultReject(error); });
    const closed = new Promise<void>((resolve) => child.once('close', (code) => {
      if (!receivedResult) {
        const error = new Error(`Clone contender exited (${code}) without a result: ${diagnostics}`);
        readyReject(error);
        resultReject(error);
      }
      resolve();
    }));
    return { child, ready, result, closed };
  }

  contenders.push(startContender(1), startContender(2));
  assert.deepEqual(await Promise.all(contenders.map((contender) => contender.ready)), [false, false]);
  for (const contender of contenders) contender.child.send({ proceed: true });
  const results = await Promise.all(contenders.map((contender) => contender.result));
  await Promise.all(contenders.map((contender) => contender.closed));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.code === 'CLONE_TARGET_ALREADY_EXISTS').length, 1);
  assert.equal(await readFile(path.join(workspacePath, 'fixture', 'fixture.txt'), 'utf8'), 'origin\n');
  assert.equal(await readFile(path.join(workspacePath, 'fixture', 'user-change.txt'), 'utf8'), 'winning checkout survives\n');
  assert.deepEqual(await readdir(workspacePath), ['fixture'], 'both processes remove their private staging directories');
});
