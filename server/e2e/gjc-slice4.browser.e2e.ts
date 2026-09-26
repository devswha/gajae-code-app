/*
 * F13 driver-level E2E fallback. Playwright is intentionally not a dependency of
 * this package, so this exercises the same durable REST/WS contracts directly:
 * orchestration, native jobs storage, managed worktrees, projection replay, and
 * the app-auth notification ledger.
 */
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { GjcGitClient } from '../services/gjc-git-client.js';
import { GjcJobGitService } from '../services/gjc-job-git.service.js';
import { JobOrchestrator, type JobSupervisor } from '../services/gjc-job-orchestrator.js';
import { GjcJobsClient } from '../services/gjc-jobs-client.js';
import { GjcJobProjectionService } from '../modules/websocket/services/gjc-job-projection.service.js';
import type { GjcWorkerSpawnRun } from '../gjc-worker-client.js';

const execFile = promisify(execFileCallback);
const corePath = join(process.cwd(), 'dist-native', 'gajae-core');

type ControlledRun = { input: GjcWorkerSpawnRun; resolve(): void };
class FakeSupervisor implements JobSupervisor {
  readonly runs: ControlledRun[] = [];
  spawnRun(input: GjcWorkerSpawnRun) {
    let resolve!: () => void;
    const completion = new Promise<void>(done => { resolve = done; });
    this.runs.push({ input, resolve });
    return { started: Promise.resolve(), completion, abortHandle: input.runId, phase: () => 'request_issued' as const };
  }
  async abort(alias: string) { this.runs.find(run => run.input.runId === alias)?.resolve(); return 'aborted' as const; }
  async terminate() { return 'reaped' as const; }
  emit(index: number, payload: unknown) { this.runs[index]?.input.writer.send(payload); }
}

class FakeSocket extends EventEmitter {
  readyState = 1;
  readonly frames: any[] = [];
  send(data: string) { this.frames.push(JSON.parse(data)); }
}

async function git(root: string, args: string[]) { return execFile('git', args, { cwd: root }); }

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gjc-slice4-driver-')));
  await git(root, ['init']);
  await writeFile(join(root, '.git', 'info', 'exclude'), '.gjc-worktrees/\n');
  await git(root, ['config', 'user.email', 'e2e@example.test']);
  await git(root, ['config', 'user.name', 'GJC E2E']);
  await writeFile(join(root, 'README.md'), 'base\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'base']);
  const jobs = new GjcJobsClient({ database: join(root, '..', `${basename(root)}.jobs.sqlite3`), corePath });
  const gitClient = new GjcGitClient({ workdir: root, corePath });
  const supervisor = new FakeSupervisor();
  let id = 0;
  const broadcasts: Array<{ jobId: string; event: any }> = [];
  const orchestrator = new JobOrchestrator({
    jobs, supervisor, owner: 'slice4-e2e', createId: () => `slice4-${++id}`,
    gitForProject: project => { assert.equal(project, root); return gitClient; },
    broadcast: (jobId, event) => broadcasts.push({ jobId, event }),
  });
  t.after(async () => { jobs.close(); gitClient.close(); await rm(join(root, '..', `${basename(root)}.jobs.sqlite3`), { force: true }); await rm(root, { recursive: true, force: true }); });
  return { root, jobs, gitClient, supervisor, orchestrator, broadcasts };
}

const options = { writer: { send() {} }, provider: 'gjc' as const, appSessionId: 'browser-session', model: 'default', effort: 'default' };

test('F13 driver-level e2e: create, run, abort, resume, diff, commit, replay, and notification dedupe', async (t) => {
  const f = await fixture(t);

  // 1. UI create contract maps to POST /jobs: 202 handle and workspace route job id.
  const created = await f.orchestrator.start('gjc', 'browser-session', f.root, 'change fixture', options);
  assert.match(created.jobId, /^job-/u);
  assert.match(created.runId!, /^run-/u);

  // 2. Worker live events are durable, contiguous, and appear once in RUN state.
  f.supervisor.emit(0, { kind: 'assistant', text: 'one' });
  f.supervisor.emit(0, { kind: 'assistant', text: 'two' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const replay = await f.jobs.replayEvents({ jobId: created.jobId, after: 0 }) as any;
    if (replay.events.length === 2) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  let events = (await f.jobs.replayEvents({ jobId: created.jobId, after: 0 })) as any;
  assert.deepEqual(events.events.map((event: any) => event.sequence), [1, 2]);
  assert.equal((await f.jobs.get({ jobId: created.jobId }) as any).state, 'running');

  // 3. Abort produces the canonical terminal event once.
  assert.equal(await f.orchestrator.abort(created.jobId), true);
  events = await f.jobs.replayEvents({ jobId: created.jobId, after: 0 }) as any;
  const terminal = events.events.at(-1);
  assert.equal(terminal.payload.outcome, 'aborted');
  assert.equal((await f.jobs.get({ jobId: created.jobId }) as any).state, 'ready');

  // Create a second job for restart/reconcile and the remaining worktree contracts.
  const active = await f.orchestrator.start('gjc', 'resume-session', f.root, 'resume me', { ...options, appSessionId: 'resume-session' });
  const beforeRestart = await f.jobs.get({ jobId: active.jobId }) as any;

  // 4. A replacement server reconciles the same native jobs DB, then resumes with a new run.
  const replacementSupervisor = new FakeSupervisor();
  const replacement = new JobOrchestrator({ jobs: f.jobs, supervisor: replacementSupervisor, owner: 'slice4-restart', createId: () => 'after-restart', gitForProject: () => f.gitClient });
  await replacement.reconcile();
  assert.equal((await f.jobs.get({ jobId: active.jobId }) as any).state, 'interrupted');
  const resumed = await replacement.resume(active.jobId, 'resume-session', 'continue', { ...options, appSessionId: 'resume-session' });
  assert.notEqual(resumed.runId, active.runId);
  replacementSupervisor.emit(0, { kind: 'assistant', text: 'after restart' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const replay = await f.jobs.replayEvents({ jobId: active.jobId, after: 0 }) as any;
    if (replay.events.length > beforeRestart.lastSequence) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const resumedEvents = await f.jobs.replayEvents({ jobId: active.jobId, after: 0 }) as any;
  assert.ok(resumedEvents.events.at(-1).sequence > beforeRestart.lastSequence);
  replacementSupervisor.runs[0]?.resolve();
  await resumed.completion;
  assert.equal((await f.jobs.get({ jobId: active.jobId }) as any).state, 'ready');

  // 5. Diff resolves only through the managed job worktree; the project root remains unchanged.
  const snapshot = await f.jobs.get({ jobId: active.jobId }) as any;
  await writeFile(join(snapshot.worktreeId, 'worker-change.txt'), 'managed\n');
  const gitService = new GjcJobGitService(f.jobs, () => f.gitClient);
  const diff = await gitService.diff(active.jobId) as any;
  assert.match(diff.text, /worker-change\.txt/u);
  assert.equal((await git(f.root, ['status', '--porcelain'])).stdout, '');

  // 6. Commit only selected worktree path, leave base HEAD/root untouched, record admin event.
  const baseHead = (await git(f.root, ['rev-parse', 'HEAD'])).stdout.trim();
  const committed = await gitService.commit(active.jobId, 'job change', ['worker-change.txt']);
  assert.notEqual(committed.commit, baseHead);
  assert.equal((await git(f.root, ['rev-parse', 'HEAD'])).stdout.trim(), baseHead);
  assert.equal((await git(f.root, ['status', '--porcelain'])).stdout, '');
  const commitEvents = await f.jobs.replayEvents({ jobId: active.jobId, after: 0 }) as any;
  assert.ok(commitEvents.events.some((event: any) => event.eventId === committed.eventId && event.payload.kind === 'git_commit'));

  // 7. Forced reconnect: durable replay N+1/N+2 is emitted before buffered live N+3, once each.
  const projection = new GjcJobProjectionService(f.jobs as any);
  const socket = new FakeSocket(); projection.attach(socket as any);
  const cursor = (await f.jobs.get({ jobId: active.jobId }) as any).lastSequence;
  await replacement.appendAdminEvent(active.jobId, 'replay-1', { kind: 'offline', step: 1 });
  await replacement.appendAdminEvent(active.jobId, 'replay-2', { kind: 'offline', step: 2 });
  await projection.handle(socket as any, { protocolVersion: 1, type: 'gjc.job.subscribe', jobId: active.jobId, after: cursor });
  const subscriptionId = socket.frames.at(-1).subscriptionId;
  const live = await f.jobs.appendAdminEvent({ jobId: active.jobId, eventId: 'live-3', payload: { kind: 'live', step: 3 } }) as any;
  projection.publish(active.jobId, live);
  await projection.handle(socket as any, { protocolVersion: 1, type: 'gjc.job.replay', jobId: active.jobId, subscriptionId, after: cursor, byteBudget: 4096 });
  const replay = socket.frames.find(frame => frame.kind === 'gjc_job_replay_chunk');
  assert.deepEqual(replay.events.map((event: any) => event.eventId), ['replay-1', 'replay-2']);
  const liveFrame = socket.frames.find(frame => frame.kind === 'gjc_job_event');
  assert.equal(liveFrame.event.eventId, 'live-3');
  assert.deepEqual([...replay.events, liveFrame.event].map((event: any) => event.sequence), [cursor + 1, cursor + 2, cursor + 3]);

  // 8. App-auth ledger claims before delivery and dedupes live, replay, and restart inputs.
  process.env.DATABASE_PATH = join(f.root, 'auth.db');
  const database = await import('../modules/database/index.js');
  database.closeConnection(); await database.initializeDatabase();
  database.getConnection().prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'e2e', 'hash')").run();
  const { createGjcTerminalNotificationAdapter } = await import('../modules/notifications/services/gjc-terminal-notification-adapter.service.js');
  let sends = 0;
  const adapter = createGjcTerminalNotificationAdapter({ authority: f.jobs, resolveUserId: () => 1, notifications: { createNotificationEvent: event => event, notifyUserIfEnabled: () => { sends += 1; } } });
  assert.equal(adapter.onCommittedEvent(created.jobId, terminal), 'accepted');
  assert.equal(adapter.onCommittedEvent(created.jobId, terminal), 'deduped');
  await adapter.startupCatchUp();
  const restartedAdapter = createGjcTerminalNotificationAdapter({ authority: f.jobs, resolveUserId: () => 1, notifications: { createNotificationEvent: event => event, notifyUserIfEnabled: () => { sends += 1; } } });
  await restartedAdapter.startupCatchUp();
  assert.equal(sends, 1);
  const ledger = database.getConnection().prepare('SELECT COUNT(*) AS count FROM gjc_terminal_notification_dispatches WHERE job_id = ? AND event_id = ?').get(created.jobId, terminal.eventId) as { count: number };
  assert.equal(ledger.count, 1);
  database.closeConnection();
});
