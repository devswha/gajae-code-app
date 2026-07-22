import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';


import { GjcJobGitService } from './gjc-job-git.service.js';

const execFile = promisify(execFileCallback);

test('job git status resolves only the stored managed worktree', async () => {
  const calls: Record<string, unknown>[] = [];
  const service = new GjcJobGitService(
    { get: async () => ({ jobId: 'job-a', repositoryRoot: '/repo', worktreeId: '/repo/.gjc-worktrees/job-a', branch: 'job/job-a', baseCommit: 'abc1234' }), appendAdminEvent: async () => ({}) },
    () => ({
      list: async () => ({ items: [{ worktreeId: '/repo/.gjc-worktrees/job-a', path: '/repo/.gjc-worktrees/job-a', branch: 'job/job-a' }] }),
      status: async params => { calls.push(params); return { clean: true, count: 0 }; },
      diff: async () => ({ patch: Buffer.alloc(0) }),
    }),
  );

  assert.deepEqual(await service.status('job-a'), { clean: true, count: 0 });
  assert.deepEqual(calls, [
    { jobId: 'job-a', branch: 'job/job-a', path: '/repo/.gjc-worktrees/job-a' },
    { jobId: 'job-a', branch: 'job/job-a', path: '/repo/.gjc-worktrees/job-a' },
  ]);
});

test('job git resolution rejects a worktree moved off its stored branch', async () => {
  const service = new GjcJobGitService(
    { get: async () => ({ jobId: 'job-a', repositoryRoot: '/repo', worktreeId: '/repo/.gjc-worktrees/job-a', branch: 'job/job-a', baseCommit: 'abc1234' }), appendAdminEvent: async () => ({}) },
    () => ({ list: async () => ({ items: [{ worktreeId: '/repo/.gjc-worktrees/job-a', path: '/repo/.gjc-worktrees/job-a', branch: 'other' }] }), status: async () => ({ clean: true, count: 0 }), diff: async () => ({}) }),
  );

  await assert.rejects(service.status('job-a'), /no longer on the job branch/);
});
test('job git diff uses the bounded native base diff including untracked files', async () => {
  const calls: Record<string, unknown>[] = [];
  const service = new GjcJobGitService(
    { get: async () => ({ jobId: 'job-a', repositoryRoot: '/repo', worktreeId: 'worktree-a', branch: 'job/job-a', baseCommit: 'abc1234' }), appendAdminEvent: async () => ({}) },
    () => ({
      list: async () => ({ items: [{ worktreeId: 'worktree-a', path: '/repo/.gjc-worktrees/job-a', branch: 'job/job-a' }] }),
      status: async () => ({ clean: false }),
      diff: async params => { calls.push(params); return { patch: Buffer.from('diff') }; },
    }),
  );

  assert.deepEqual(await service.diff('job-a'), { text: 'diff', paths: [] });
  assert.deepEqual(calls, [{ jobId: 'job-a', branch: 'job/job-a', path: '/repo/.gjc-worktrees/job-a', mode: 'base', baseCommit: 'abc1234', includeUntracked: true }]);
});

test('job git commit resolves its managed worktree, commits changed relative paths, and records an admin event', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gjc-job-commit-'));
  const events: Record<string, unknown>[] = [];
  const commands = async (...args: string[]) => execFile('git', args, { cwd: directory });
  try {
    await commands('init');
    await commands('config', 'user.email', 'test@example.com');
    await commands('config', 'user.name', 'GJC test');
    await writeFile(path.join(directory, 'changed.txt'), 'changed\n');
    await writeFile(path.join(directory, 'unrelated.txt'), 'unrelated\n');
    await commands('add', 'unrelated.txt');
    const service = new GjcJobGitService(
      {
        get: async () => ({ jobId: 'job-a', repositoryRoot: '/repository-root', worktreeId: 'worktree-a', branch: 'job/job-a', baseCommit: 'base' }),
        appendAdminEvent: async params => { events.push(params); return {}; },
      },
      () => ({
        list: async () => ({ items: [{ worktreeId: 'worktree-a', path: directory, branch: 'job/job-a' }] }),
        status: async () => ({ clean: false }),
        diff: async () => ({}),
      }),
    );

    const result = await service.commit('job-a', '  Commit changed file  ', ['changed.txt']);
    assert.match(result.commit, /^[0-9a-f]{40}$/u);
    assert.match(result.eventId, /^commit\./u);
    assert.deepEqual((await commands('show', '--format=%s', '--no-patch')).stdout.trim(), 'Commit changed file');
    assert.deepEqual((await commands('show', '--format=', '--name-only', 'HEAD')).stdout.trim(), 'changed.txt');
    assert.deepEqual((await commands('diff', '--cached', '--name-only')).stdout.trim(), 'unrelated.txt');
    assert.deepEqual(events, [{ jobId: 'job-a', eventId: result.eventId, payload: { kind: 'git_commit', commit: result.commit, paths: ['changed.txt'] } }]);

    for (const [message, paths] of [
      ['', ['changed.txt']],
      ['message', ['/absolute.txt']],
      ['message', ['../traversal.txt']],
      ['message', ['unchanged.txt']],
      ['message', Array.from({ length: 101 }, (_, index) => `file-${index}`)],
    ] as const) await assert.rejects(service.commit('job-a', message, paths), { code: 'invalid_request' });
    await assert.rejects(service.commit('job-a', 'a'.repeat(4097), ['changed.txt']), { code: 'invalid_request' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('job git summaries isolate failures, parse patches, and cache by lifecycle state', async () => {
  const snapshots = new Map<string, Record<string, unknown>>([
    ['active', { jobId: 'active', state: 'running', lastSequence: 1, repositoryRoot: '/repo', worktreeId: 'active', branch: 'job/active', baseCommit: 'base' }],
    ['terminal', { jobId: 'terminal', state: 'ready', lastSequence: 1, repositoryRoot: '/repo', worktreeId: 'terminal', branch: 'job/terminal', baseCommit: 'base' }],
    ['broken', { jobId: 'broken', state: 'ready', lastSequence: 1, repositoryRoot: '/repo', worktreeId: 'broken', branch: 'job/broken', baseCommit: 'base' }],
  ]);
  const calls = { get: 0, list: 0, status: 0, diff: 0 };
  const service = new GjcJobGitService(
    {
      get: async ({ jobId }) => { calls.get++; return snapshots.get(String(jobId)); },
      appendAdminEvent: async () => ({}),
    },
    () => ({
      list: async () => { calls.list++; return { items: ['active', 'terminal', 'broken'].map(worktreeId => ({ worktreeId, path: `/worktrees/${worktreeId}`, branch: `job/${worktreeId}` })) }; },
      status: async () => { calls.status++; return {}; },
      diff: async ({ jobId }) => {
        calls.diff++;
        if (jobId === 'broken') throw new Error('diff unavailable');
        return { patch: [
          'diff --git a/a.txt b/a.txt',
          '--- a/a.txt',
          '+++ b/a.txt',
          '+added',
          '-removed',
          'diff --git a/b.txt b/b.txt',
          '+second addition',
          '\\ No newline at end of file',
        ].join('\n') };
      },
    }),
  );

  assert.deepEqual(await service.summaries(['active', 'broken']), {
    active: { status: 'available', files: 2, additions: 2, deletions: 1, stale: true },
    broken: { status: 'unavailable' },
  });
  assert.equal(calls.diff, 2);
  assert.deepEqual(await service.summaries(['active']), { active: { status: 'available', files: 2, additions: 2, deletions: 1, stale: true } });
  assert.equal(calls.diff, 2);

  assert.deepEqual(await service.summaries(['terminal']), { terminal: { status: 'available', files: 2, additions: 2, deletions: 1, stale: false } });
  assert.equal(calls.diff, 3);
  assert.deepEqual(await service.summaries(['terminal']), { terminal: { status: 'available', files: 2, additions: 2, deletions: 1, stale: false } });
  assert.equal(calls.diff, 3);
  snapshots.set('active', { ...snapshots.get('active')!, state: 'ready', lastSequence: 2 });
  assert.deepEqual(await service.summaries(['active']), { active: { status: 'available', files: 2, additions: 2, deletions: 1, stale: false } });
  assert.equal(calls.diff, 4);
  assert.deepEqual(await service.summaries(['active'], { forceRefresh: true }), { active: { status: 'available', files: 2, additions: 2, deletions: 1, stale: false } });
  assert.equal(calls.diff, 5);
  assert.equal(calls.get, 7);
  assert.equal(calls.list, 5);
  assert.equal(calls.status, 5);
});

test('job git summaries allow 50 unique job IDs and reject larger batches', async () => {
  const service = new GjcJobGitService(
    { get: async ({ jobId }) => ({ jobId, state: 'ready', lastSequence: 1, repositoryRoot: '/repo', worktreeId: jobId, branch: `job/${jobId}`, baseCommit: 'base' }), appendAdminEvent: async () => ({}) },
    () => ({ list: async () => ({ items: [] }), status: async () => ({}), diff: async () => ({}) }),
  );
  assert.equal(Object.keys(await service.summaries(Array.from({ length: 50 }, (_, index) => `job-${index}`))).length, 50);
  await assert.rejects(service.summaries(Array.from({ length: 51 }, (_, index) => `job-${index}`)), { code: 'invalid_request' });
});
