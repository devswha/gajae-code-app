import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import type { GjcWorkerSpawnRun } from '../gjc-worker-client.js';

import { GjcGitClient } from './gjc-git-client.js';
import { GjcCapacityExhaustedError, JobOrchestrator, type JobSupervisor } from './gjc-job-orchestrator.js';
import { GjcJobsClient, GjcJobsEventTooLargeError } from './gjc-jobs-client.js';

const execFile = promisify(execFileCallback);
const corePath = join(process.cwd(), 'dist-native', 'gajae-core');
const workerOptions = { writer: { send() {} } };

class FakeSupervisor implements JobSupervisor {
  readonly inputs: GjcWorkerSpawnRun[] = [];
  spawnRun(input: GjcWorkerSpawnRun) {
    this.inputs.push(input);
    return { started: Promise.resolve(), completion: new Promise<void>(() => {}), abortHandle: input.runId };
  }
  async abort() { return 'aborted' as const; }
}

type Fixture = {
  root: string;
  jobs: GjcJobsClient;
  git: GjcGitClient;
  gitRoots: string[];
  supervisor: FakeSupervisor;
  orchestrator: JobOrchestrator;
  events: Array<{ eventId: string; sequence: number; payload: unknown }>;
  close(): Promise<void>;
};

async function fixture(t: test.TestContext): Promise<Fixture> {
  // Canonicalize the temp root so worktree paths match git.rs canonical output
  // (macOS resolves /var -> /private/var), keeping assertions/workdir consistent.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gjc-job-orchestrator-e2e-')));
  await execFile('git', ['init'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'e2e@example.test'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'GJC E2E'], { cwd: root });
  await writeFile(join(root, 'README.md'), 'fixture\n');
  await execFile('git', ['add', 'README.md'], { cwd: root });
  await execFile('git', ['commit', '-m', 'fixture'], { cwd: root });

  const jobs = new GjcJobsClient({ database: join(root, 'jobs.sqlite3'), corePath });
  const git = new GjcGitClient({ workdir: root, corePath });
  const supervisor = new FakeSupervisor();
  let next = 0;
  const gitRoots: string[] = [];
  const events: Array<{ eventId: string; sequence: number; payload: unknown }> = [];
  const orchestrator = new JobOrchestrator({
    jobs,
    gitForProject: (projectRoot) => {
      gitRoots.push(projectRoot);
      if (projectRoot !== root) throw new Error(`Unexpected repository root: ${projectRoot}`);
      return git;
    },
    supervisor,
    owner: 'e2e-owner',
    createId: () => `e2e-${++next}`,
    broadcast: (_jobId, event) => events.push(event),
  });
  const close = async () => {
    jobs.close();
    git.close();
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  };
  t.after(close);
  return { root, jobs, git, gitRoots, supervisor, orchestrator, events, close };
}

async function worktreeCount(root: string): Promise<number> {
  const { stdout } = await execFile('git', ['worktree', 'list', '--porcelain'], { cwd: root });
  return stdout.split('\n').filter((line) => line.startsWith('worktree ')).length;
}

test('native cancelAdmission atomically replays and broadcasts a pre-start terminal failure', async (t) => {
  const f = await fixture(t);
  f.supervisor.spawnRun = (input) => ({
    started: Promise.reject(new Error('native start failed')),
    completion: new Promise<void>(() => {}),
    outcome: Promise.resolve('not_started'),
    abortHandle: input.runId,
  });

  await assert.rejects(
    f.orchestrator.start('gjc', 'failed-session', f.root, 'fail before start', workerOptions),
    /native start failed/u,
  );

  const job = await f.jobs.get({ jobId: 'job-e2e1' }) as { state: string };
  assert.equal(job.state, 'failed');
  const replay = await f.jobs.replayEvents({ jobId: 'job-e2e1', after: 0 }) as {
    events: Array<{ eventId: string; sequence: number; payload: unknown }>;
  };
  const terminals = replay.events.filter((event) => event.eventId === 'run-terminal:run-e2e-2');
  assert.deepEqual(terminals, [{
    eventId: 'run-terminal:run-e2e-2',
    sequence: 2,
    payload: {
      schemaVersion: 1,
      kind: 'job_terminal',
      runId: 'run-e2e-2',
      appSessionId: 'failed-session',
      outcome: 'failed',
      jobState: 'failed',
      reason: 'native start failed',
    },
  }]);
  assert.deepEqual(f.events, terminals);
});
test('capacity rejects the fifth bound start without creating a conflicting binding', async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 5 }, (_, index) =>
    f.orchestrator.start('gjc', `capacity-session-${index}`, f.root, `message-${index}`, { ...workerOptions, cap: 4 }),
  ));
  const listed = await f.jobs.list({}) as { items: unknown[]; nextCursor: string | null };
  const list = listed.items;
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 4);
  assert.equal(listed.nextCursor, null);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.match(String((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason), /waiting for capacity/u);
  assert.equal(list.filter((job) => ['queued', 'running'].includes(String((job as { state: string }).state))).length, 4);
  assert.equal(f.supervisor.inputs.length, 4);
});

test('start always dispatches from a managed worktree rather than the project root', async (t) => {
  const f = await fixture(t);
  const result = await f.orchestrator.start('gjc', 'e2e-session', f.root, 'worktree window', workerOptions);
  const cwd = f.supervisor.inputs[0]?.options?.cwd;
  const expected = (await f.jobs.get({ jobId: result.jobId }) as { worktreeId: string }).worktreeId;
  assert.equal(cwd, expected);
  assert.notEqual(cwd, f.root);
  assert.ok(existsSync(expected));
  const { stdout } = await execFile('git', ['worktree', 'list', '--porcelain'], { cwd: f.root });
  assert.match(stdout, new RegExp(`worktree ${expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`));
  assert.match(stdout, new RegExp(`branch refs/heads/job/${result.jobId}`));
});

test('reconcile then resume reuses the original worktree and creates a new run', async (t) => {
  const f = await fixture(t);
  const first = await f.orchestrator.start('gjc', 'e2e-session', f.root, 'resume me', workerOptions);
  const worktreesBefore = await worktreeCount(f.root);
  await f.orchestrator.reconcile();
  const interrupted = await f.jobs.get({ jobId: first.jobId }) as { state: string; worktreeId: string };
  assert.equal(interrupted.state, 'interrupted');
  assert.equal(interrupted.worktreeId, f.supervisor.inputs[0]?.options?.cwd);
  const resumed = await f.orchestrator.resume(first.jobId, 'e2e-session', 'resumed', workerOptions);
  assert.notEqual(resumed.runId, first.runId);
  assert.equal(f.supervisor.inputs.length, 2);
  assert.equal(f.supervisor.inputs[1]?.options?.cwd, interrupted.worktreeId);
  assert.equal(await worktreeCount(f.root), worktreesBefore);
  assert.deepEqual(f.gitRoots, [f.root, f.root]);
});
test('resume at capacity preserves the interrupted job without starting a worker', async (t) => {
  const f = await fixture(t);
  const interrupted = await f.orchestrator.start('gjc', 'e2e-session', f.root, 'interrupt me', workerOptions);
  await f.orchestrator.reconcile();
  assert.equal((await f.jobs.get({ jobId: interrupted.jobId }) as { state: string }).state, 'interrupted');

  await Promise.all(Array.from({ length: 4 }, (_, index) =>
    f.orchestrator.start('gjc', `capacity-session-${index}`, f.root, `capacity-${index}`, workerOptions),
  ));
  const startedWorkers = f.supervisor.inputs.length;
  await assert.rejects(
    f.orchestrator.resume(interrupted.jobId, 'e2e-session', 'resume', workerOptions),
    (error: unknown) => error instanceof GjcCapacityExhaustedError && error.jobId === interrupted.jobId,
  );
  assert.equal((await f.jobs.get({ jobId: interrupted.jobId }) as { state: string }).state, 'interrupted');
  assert.equal(f.supervisor.inputs.length, startedWorkers);
});

test('confirmed prune rejects a dirty managed worktree without removing it', async (t) => {
  const f = await fixture(t);
  const result = await f.orchestrator.start('gjc', 'e2e-session', f.root, 'make dirty', workerOptions);
  const path = join(f.root, '.gjc-worktrees', result.jobId);
  await writeFile(join(path, 'uncommitted.txt'), 'dirty\n');
  await assert.rejects(
    f.git.prune({ jobId: result.jobId, branch: `job/${result.jobId}`, path, confirmed: true }),
    /dirty_worktree/u,
  );
  assert.ok(existsSync(path));
});

test('a closed jobs client rejects admission without creating state or a worktree', async (t) => {
  const f = await fixture(t);
  f.jobs.close();
  await assert.rejects(f.orchestrator.start('gjc', 'e2e-session', f.root, 'must not start', workerOptions), /unavailable/u);
  assert.equal(f.supervisor.inputs.length, 0);
  assert.equal(await worktreeCount(f.root), 1);

  const inspector = new GjcJobsClient({ database: join(f.root, 'jobs.sqlite3'), corePath });
  t.after(() => inspector.close());
  assert.deepEqual(await inspector.list({}), { items: [], nextCursor: null });
});
test('oversized worker events are rejected without interrupting other active jobs', async (t) => {
  const f = await fixture(t);
  const first = await f.orchestrator.start('gjc', 'e2e-session', f.root, 'first', workerOptions);
  await assert.rejects(
    f.jobs.appendEvent({ jobId: first.jobId, payload: { content: 'x'.repeat(64 * 1024) } }),
    (error: unknown) => error instanceof GjcJobsEventTooLargeError && error.code === 'event_too_large',
  );
  const second = await f.orchestrator.start('gjc', 'second-session', f.root, 'second', workerOptions);
  assert.equal((await f.jobs.get({ jobId: first.jobId }) as { state: string }).state, 'running');
  assert.equal((await f.jobs.get({ jobId: second.jobId }) as { state: string }).state, 'running');
});
