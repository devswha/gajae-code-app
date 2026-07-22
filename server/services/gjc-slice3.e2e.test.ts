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
import { JobOrchestrator, type JobSupervisor } from './gjc-job-orchestrator.js';
import { GjcJobsClient } from './gjc-jobs-client.js';

const execFile = promisify(execFileCallback);
const corePath = join(process.cwd(), 'dist-native', 'gajae-core');

class FakeSupervisor implements JobSupervisor {
  spawnRun(input: GjcWorkerSpawnRun) {
    return { started: Promise.resolve(), completion: new Promise<void>(() => {}), abortHandle: input.runId };
  }
  async abort() { return 'aborted' as const; }
}

test('Slice 3 persists lease-free publish lifecycle events only after a run is ready', { skip: !existsSync(corePath) }, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gjc-slice3-e2e-')));
  const jobs = new GjcJobsClient({ database: join(root, 'jobs.sqlite3'), corePath });
  const git = new GjcGitClient({ workdir: root, corePath });
  t.after(async () => { jobs.close(); git.close(); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  await execFile('git', ['init'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'e2e@example.test'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'GJC E2E'], { cwd: root });
  await writeFile(join(root, 'README.md'), 'fixture\n');
  await execFile('git', ['add', 'README.md'], { cwd: root });
  await execFile('git', ['commit', '-m', 'fixture'], { cwd: root });

  let next = 0;
  const orchestrator = new JobOrchestrator({
    jobs,
    gitForProject: () => git,
    supervisor: new FakeSupervisor(),
    owner: 'slice3-owner',
    createId: () => `slice3-${++next}`,
  });
  const handle = await orchestrator.start('gjc', 'slice3-session', root, 'admin event fixture', { writer: { send() {} } });
  const running = await jobs.get({ jobId: handle.jobId }) as { lease: { owner: string; generation: number }; state: string };
  await assert.rejects(jobs.appendAdminEvent({ jobId: handle.jobId, eventId: 'publish.started', payload: {} }), /invalid_transition/u);
  await jobs.runFinalize({
    jobId: handle.jobId,
    lease: running.lease,
    runId: handle.runId,
    terminalRunState: 'succeeded',
    eventId: 'run.complete',
    payload: { kind: 'completed' },
  });
  const started = await jobs.appendAdminEvent({ jobId: handle.jobId, eventId: 'publish.started', payload: { branch: `job/${handle.jobId}` } }) as { sequence: number };
  const duplicate = await jobs.appendAdminEvent({ jobId: handle.jobId, eventId: 'publish.started', payload: { branch: `job/${handle.jobId}` } }) as { sequence: number };
  assert.equal(started.sequence, duplicate.sequence);
  const replay = await jobs.replayEvents({ jobId: handle.jobId, after: 0 }) as { events: Array<{ eventId: string }> };
  assert.deepEqual(replay.events.map(event => event.eventId), ['run.complete', 'publish.started']);
});
