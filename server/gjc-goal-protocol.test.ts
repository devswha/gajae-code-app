import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GjcWorkerHost, type GjcWorkerRuntime } from './gjc-worker.js';
import type { GjcWorkerRequestFrame } from './gjc-worker-protocol.js';

test('goal protocol rejects cross-session, stale-run, extra-field and malformed operations', async () => {
  const frames: Array<Record<string, any>> = [];
  const calls: unknown[] = [];
  let finish!: () => void;
  const completion = new Promise<void>((resolve) => { finish = resolve; });
  const runtime: GjcWorkerRuntime = {
    spawnGjc: () => Object.assign(completion, { abortHandle: 'exact-run' }),
    abortGjcSession: async () => true,
    resolveGjcToolApproval: () => false,
    controlGjcGoal: async (...args) => { calls.push(args); return { supported: true, goal: null, runId: 'exact-run', canControl: true, resumeRequired: false }; },
    inspectGjcGoal: async () => { throw new Error('Should not inspect an active scope'); },
  };
  const host = new GjcWorkerHost({ runtime: async () => runtime, emit: (frame) => frames.push(frame) });
  const send = (method: string, id: string, payload: Record<string, unknown>, sessionId = 'app-a') => host.handle({ protocolVersion: 1, kind: 'request', id, method, payload, ...(method === 'worker.initialize' ? {} : { sessionId }) } as GjcWorkerRequestFrame);
  await send('worker.initialize', 'init', {});
  const run = send('session.start', 'run-a', { message: 'test', options: {} });
  const control = { owner: 'number:1', cwd: '/project', runId: 'run-a', command: { operation: 'pause', goalId: 'goal-a' } };
  await send('goal.control', 'foreign', control, 'app-b');
  await send('goal.control', 'stale', { ...control, runId: 'old-run' });
  await send('goal.control', 'extra', { ...control, allowedOps: ['complete'] });
  await send('goal.control', 'malformed', { ...control, command: { operation: 'resume', goalId: null } });
  await send('goal.inspect', 'busy', { owner: 'number:1', cwd: '/project', providerSessionId: 'provider-a', sessionRoot: '/sessions' });
  assert.equal(calls.length, 0);
  for (const id of ['foreign', 'stale', 'extra', 'malformed', 'busy']) assert.equal(frames.find((frame) => frame.id === id)?.payload.ok, false);
  await send('goal.control', 'valid', control);
  assert.deepEqual(calls, [['exact-run', { appSessionId: 'app-a', owner: 'number:1', cwd: '/project' }, { operation: 'pause', goalId: 'goal-a' }, true]]);
  await send('goal.control', 'native-owner', { ...control, stopAfterMutation: false });
  assert.equal((calls.at(-1) as unknown[]).at(-1), false);
  const beforeInvalidStop = calls.length;
  await send('goal.control', 'invalid-stop-policy', { ...control, stopAfterMutation: 'false' });
  assert.equal(calls.length, beforeInvalidStop);
  assert.equal(frames.find((frame) => frame.id === 'invalid-stop-policy')?.payload.ok, false);
  finish();
  await run;
  await send('goal.control', 'settled', control);
  assert.equal(frames.find((frame) => frame.id === 'settled')?.payload.ok, false);
  await host.close();
});
