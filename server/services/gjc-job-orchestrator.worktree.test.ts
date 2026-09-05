import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import type { GjcWorkerSpawnRun } from '../gjc-worker-client.js';

import { GjcGitClient } from './gjc-git-client.js';
import { JobOrchestrator, type JobSupervisor } from './gjc-job-orchestrator.js';
import { GjcJobsClient } from './gjc-jobs-client.js';

const execFile = promisify(execFileCallback);
const writer = { send() {} };

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gjc-session-worktree-')));
  const repository = path.join(root, 'repository');
  const foreign = path.join(root, 'foreign');
  const environment = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  for (const cwd of [repository, foreign]) {
    await mkdir(cwd);
    const git = (...args: string[]) => execFile('git', [
      '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(root, 'no-hooks')}`,
      '-c', 'user.name=Worktree Test', '-c', 'user.email=worktree@example.test', ...args,
    ], { cwd, env: environment });
    await git('init');
    await writeFile(path.join(cwd, 'README.md'), 'fixture\n');
    await git('add', 'README.md');
    await git('commit', '-m', 'fixture');
  }
  const corePath = path.join(process.cwd(), 'dist-native', process.platform === 'win32' ? 'gajae-core.exe' : 'gajae-core');
  const jobs = new GjcJobsClient({ database: path.join(root, 'jobs.sqlite3'), corePath });
  const git = new GjcGitClient({ workdir: repository, corePath });
  t.after(async () => {
    jobs.close();
    git.close();
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const inputs: GjcWorkerSpawnRun[] = [];
  const finish: Array<() => void> = [];
  const supervisor: JobSupervisor = {
    spawnRun(input) {
      inputs.push(input);
      return {
        started: Promise.resolve(),
        completion: new Promise<void>((resolve) => finish.push(resolve)),
        abortHandle: input.runId,
      };
    },
    async abort() { return 'aborted'; },
  };
  let sequence = 0;
  const orchestrator = new JobOrchestrator({ jobs, git, supervisor, owner: 'worktree-test', createId: () => `worktree-${++sequence}` });
  const first = await orchestrator.start('gjc', 'app-session', repository, 'fixture only', { writer });
  inputs[0].writer.setSessionId?.('provider-session');
  finish[0]();
  await first.completion;
  const cwd = inputs[0].options?.cwd;
  assert.ok(cwd);
  return { root, repository, foreign, cwd, inputs, finish, orchestrator };
}

test('bound continuation keeps the validated worktree and provider identity across turns', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.cwd, 'README.md'), 'first turn edits\n');
  const second = await f.orchestrator.turnStart('gjc', 'app-session', 'continue', { writer });
  assert.equal(f.inputs.length, 2);
  assert.equal(f.inputs[1].options?.cwd, f.cwd);
  assert.equal(f.inputs[1].options?.sessionId, 'provider-session');
  assert.equal(await readFile(path.join(f.cwd, 'README.md'), 'utf8'), 'first turn edits\n');
  assert.equal(await readFile(path.join(f.repository, 'README.md'), 'utf8'), 'fixture\n');
  f.finish[1]();
  await second.completion;
});

test('bound continuation refuses a missing worktree before worker dispatch', async (t) => {
  const f = await fixture(t);
  await rename(f.cwd, path.join(f.root, 'saved-worktree'));
  await assert.rejects(f.orchestrator.turnStart('gjc', 'app-session', 'continue', { writer }));
  assert.equal(f.inputs.length, 1);
});

test('bound continuation refuses a foreign-repository symlink before worker dispatch', async (t) => {
  const f = await fixture(t);
  await rename(f.cwd, path.join(f.root, 'saved-worktree'));
  await symlink(f.foreign, f.cwd, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.orchestrator.turnStart('gjc', 'app-session', 'continue', { writer }));
  assert.equal(f.inputs.length, 1);
  assert.equal(await readFile(path.join(f.foreign, 'README.md'), 'utf8'), 'fixture\n');
});

test('bound continuation refuses a replaced Git pointer before worker dispatch', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.cwd, '.git'), `gitdir: ${path.join(f.foreign, '.git')}\n`);
  await assert.rejects(f.orchestrator.turnStart('gjc', 'app-session', 'continue', { writer }));
  assert.equal(f.inputs.length, 1);
});
