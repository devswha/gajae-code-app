import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { getProductionJobOrchestrator } from '../services/gjc-job-orchestrator.js';

const moduleDatabaseDirectory = await mkdtemp(path.join(os.tmpdir(), 'gjc-jobs-router-'));
const moduleDatabasePath = path.join(moduleDatabaseDirectory, 'auth.db');
const originalModuleDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = moduleDatabasePath;

const {
  createGjcJobsRouter,
  default: router,
  decodeListQuery,
  decodeReplayQuery,
  decodeGitSummariesQuery,
  statusForGjcError,
} = await import('./gjc-jobs.js');

test.after(async () => {
  getProductionJobOrchestrator().close();
  if (originalModuleDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalModuleDatabasePath;
  await rm(moduleDatabaseDirectory, { recursive: true, force: true });
});

const serve = async (route = router) => {
  const app = express();
  app.use(route);
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    request: (pathname, options) => fetch(`http://127.0.0.1:${port}${pathname}`, options),
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
};

test('GJC jobs routes keep the authority alive across invalid and valid pagination requests', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'gjc-jobs-route-'));
  const originalDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');
  const server = await serve();
  try {
    assert.equal((await server.request('/jobs?cursor=invalid%20cursor')).status, 400);
    const response = await server.request('/jobs?limit=10');
    assert.equal(response.status, 200);
    assert.equal((await server.request('/jobs?cursor=MIGRATED_Job.1%3Aorigin')).status, 200);
    assert.deepEqual(await response.json(), { items: [], nextCursor: null });
  } finally {
    await server.close();
    getProductionJobOrchestrator().close();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('GJC jobs pagination decodes HTTP query values into the native envelope', () => {
  assert.deepEqual(decodeListQuery({ limit: '10', cursor: 'MIGRATED_Job.1:origin' }), { archived: 'exclude', afterCursor: 'MIGRATED_Job.1:origin', limit: 10 });
  assert.deepEqual(decodeListQuery({ limit: '999' }), { archived: 'exclude', limit: 100 });
  assert.deepEqual(decodeListQuery({ archived: 'only' }), { archived: 'only' });
  assert.deepEqual(decodeReplayQuery({ cursor: '12' }), { after: 12 });
});
test('GJC event replay clamps byte budgets before forwarding to native authority', () => {
  assert.deepEqual(decodeReplayQuery({ cursor: '12', byteBudget: '1' }), { after: 12, byteBudget: 4096 });
  assert.deepEqual(decodeReplayQuery({ byteBudget: '999999' }), { byteBudget: 49152 });
  assert.deepEqual(decodeReplayQuery({ byteBudget: '8192' }), { byteBudget: 8192 });
});


test('GJC jobs pagination rejects values that would violate the native envelope', () => {
  assert.throws(() => decodeListQuery({ limit: 'not-a-number' }), { code: 'invalid_request' });
  assert.throws(() => decodeListQuery({ cursor: 'invalid cursor' }), { code: 'invalid_request' });
  assert.throws(() => decodeListQuery({ archived: 'all' }), { code: 'invalid_request' });
  assert.throws(() => decodeListQuery({ archived: ['exclude', 'only'] }), { code: 'invalid_request' });
  assert.throws(() => decodeReplayQuery({ cursor: '1.5' }), { code: 'invalid_request' });
  assert.throws(() => decodeReplayQuery({ cursor: ['1', '2'] }), { code: 'invalid_request' });
});
test('GJC event replay rejects invalid byte budgets before native authority access', () => {
  assert.throws(() => decodeReplayQuery({ byteBudget: '1.5' }), { code: 'invalid_request' });
  assert.throws(() => decodeReplayQuery({ byteBudget: ['4096', '8192'] }), { code: 'invalid_request' });
  assert.throws(() => decodeReplayQuery({ byteBudget: String(Number.MAX_SAFE_INTEGER + 1) }), { code: 'invalid_request' });
});
test('GJC job creation rejects managed worktree project paths before orchestrator access', async () => {
  let starts = 0;
  const orchestrator = { start: async () => { starts++; throw new Error('must not be called'); } };
  const app = express();
  app.use(express.json());
  app.use(createGjcJobsRouter({ orchestrator, gitService: {} }));
  const server = await serve(app);
  try {
    for (const projectPath of [
      '/Users/dev/repo/.gjc-worktrees/job-1',
      'C:\\repo\\.gjc-worktrees\\job-2',
      '/Users/dev/repo/.gjc-worktrees',
    ]) {
      const response = await server.request('/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'do it', projectPath }),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'managed_worktree_project');
    }
    assert.equal(starts, 0);
  } finally {
    await server.close();
  }
});
test('GJC git summaries use one batch service call for multiple jobs', async () => {
  const calls = [];
  const gitService = {
    summaries: async (jobIds, options) => {
      calls.push({ jobIds, options });
      return Object.fromEntries(jobIds.map(jobId => [jobId, { status: 'available', files: 1, additions: 2, deletions: 3, stale: false }]));
    },
  };
  const server = await serve(createGjcJobsRouter({ gitService }));
  try {
    const response = await server.request('/jobs/git-summaries?jobIds=job-1,job-2,job-3');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      'job-1': { status: 'available', files: 1, additions: 2, deletions: 3, stale: false },
      'job-2': { status: 'available', files: 1, additions: 2, deletions: 3, stale: false },
      'job-3': { status: 'available', files: 1, additions: 2, deletions: 3, stale: false },
    });
    assert.deepEqual(calls, [{ jobIds: ['job-1', 'job-2', 'job-3'], options: { forceRefresh: false } }]);
  } finally {
    await server.close();
  }
});
test('GJC git summaries reject malformed, duplicate, and oversized job IDs before service access', async () => {
  let calls = 0;
  const gitService = { summaries: async () => { calls++; throw new Error('must not be called'); } };
  const server = await serve(createGjcJobsRouter({ gitService }));
  const fiftyOne = Array.from({ length: 51 }, (_, index) => `job-${index}`).join(',');
  try {
    for (const query of ['', 'job-1,,job-2', 'job-1,job-1', 'invalid%20job', fiftyOne, 'job-1&refresh=false']) {
      assert.equal((await server.request(`/jobs/git-summaries?jobIds=${query}`)).status, 400);
    }
    assert.throws(() => decodeGitSummariesQuery({ jobIds: ['job-1', 'job-2'] }), { code: 'invalid_request' });
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});
test('GJC git summaries forward refresh and isolate unavailable jobs', async () => {
  let calls = 0;
  const gitService = {
    summaries: async (jobIds, options) => {
      assert.deepEqual(jobIds, ['available-job', 'unavailable-job']);
      assert.deepEqual(options, { forceRefresh: true });
      calls++;
      return {
        'available-job': { status: 'available', files: 4, additions: 5, deletions: 6, stale: true },
        'unavailable-job': { status: 'unavailable' },
      };
    },
  };
  const server = await serve(createGjcJobsRouter({ gitService }));
  try {
    const response = await server.request('/jobs/git-summaries?jobIds=available-job,unavailable-job&refresh=true');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      'available-job': { status: 'available', files: 4, additions: 5, deletions: 6, stale: true },
      'unavailable-job': { status: 'unavailable' },
    });
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});
test('GJC archive routes forward exact envelopes and preserve authority error statuses', async () => {
  const calls = [];
  const error = code => Object.assign(new Error(code), { code });
  const authority = {
    list: async params => {
      calls.push(['list', params]);
      return { items: [{ jobId: 'job-1', state: 'completed' }], nextCursor: 'cursor-2' };
    },
    archive: async params => {
      calls.push(['archive', params]);
      if (params.jobId === 'active-job') throw error('invalid_transition');
      return { jobId: params.jobId, archivedAt: '2026-07-20T00:00:00.000Z' };
    },
    unarchive: async params => {
      calls.push(['unarchive', params]);
      if (params.jobId === 'active-job') throw error('invalid_transition');
      if (params.jobId === 'missing-job') throw error('not_found');
      return { jobId: params.jobId, archivedAt: null };
    },
  };
  const server = await serve(createGjcJobsRouter({ authority }));
  try {
    assert.equal((await server.request('/jobs?archived=invalid')).status, 400);
    assert.deepEqual(await (await server.request('/jobs')).json(), { items: [{ jobId: 'job-1', state: 'completed' }], nextCursor: 'cursor-2' });
    assert.deepEqual(await (await server.request('/jobs?archived=only')).json(), { items: [{ jobId: 'job-1', state: 'completed' }], nextCursor: 'cursor-2' });
    assert.deepEqual(await (await server.request('/jobs/job-1/archive', { method: 'POST' })).json(), { jobId: 'job-1', archivedAt: '2026-07-20T00:00:00.000Z' });
    assert.deepEqual(await (await server.request('/jobs/job-1/unarchive', { method: 'POST' })).json(), { jobId: 'job-1', archivedAt: null });
    assert.equal((await server.request('/jobs/active-job/archive', { method: 'POST' })).status, 409);
    assert.equal((await server.request('/jobs/missing-job/unarchive', { method: 'POST' })).status, 404);
    assert.deepEqual(calls, [
      ['list', { archived: 'exclude' }],
      ['list', { archived: 'only' }],
      ['archive', { jobId: 'job-1' }],
      ['unarchive', { jobId: 'job-1' }],
      ['archive', { jobId: 'active-job' }],
      ['unarchive', { jobId: 'missing-job' }],
    ]);
  } finally {
    await server.close();
  }
});

test('GJC jobs errors use availability, conflict, and missing-resource statuses', () => {
  const error = code => Object.assign(new Error(code), { code });
  assert.equal(statusForGjcError(error('GJC_JOB_AUTHORITY_UNAVAILABLE')), 503);
  assert.equal(statusForGjcError(error('already_exists')), 409);
  assert.equal(statusForGjcError(error('invalid_transition')), 409);
  assert.equal(statusForGjcError(error('lease_held')), 409);
  assert.equal(statusForGjcError(error('stale_lease')), 409);
  assert.equal(statusForGjcError(error('capacity_exhausted')), 409);
  assert.equal(statusForGjcError(error('not_found')), 404);
  assert.equal(statusForGjcError(error('invalid_request')), 400);
  assert.equal(statusForGjcError(error('storage_failure')), 503);
});