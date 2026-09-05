import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SessionLifecycleService,
  type SessionCreateRequest,
  type SessionLifecycleClient,
} from '@gajae-code/coding-agent/sdk/lifecycle/service';

// Exercise the published facade with an injected transport only. Never use
// createSessionLifecycleService here: its default transport starts a broker
// and session host. These fixture paths are data, not filesystem targets.
const repository = '/session-worktree-contract/repository';
const executionCwd = `${repository}/.worktrees/session-one`;
const actor = { namespace: 'gajae-app-worktree-contract', id: 'owner-one' };
const request: Omit<SessionCreateRequest, 'operation'> = {
  actor,
  capability: 'session.create',
  requestKey: 'app-session-one',
  target: {
    cwd: repository,
    worktree: { enabled: true, name: 'session-one' },
  },
};

function fixture(response: unknown) {
  const calls: Array<Parameters<SessionLifecycleClient['global']>> = [];
  const service = new SessionLifecycleService({
    async global(...args) {
      calls.push(args);
      return response;
    },
  });
  return { service, calls };
}

test('public lifecycle create carries the worktree target and returns the actual cwd', async () => {
  const { service, calls } = fixture({
    ok: true,
    result: { sessionId: 'provider-session-one', cwd: executionCwd, endpointGeneration: 1 },
  });
  const outcome = await service.create(request);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'session.create');
  assert.deepEqual(calls[0][1].worktree, { enabled: true, name: 'session-one' });
  assert.equal(calls[0][1].cwd, repository);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.cwd, executionCwd);
  assert.equal(outcome.result.sessionId, 'provider-session-one');
});

test('deferred readiness still dispatches session.create through the lifecycle transport', async () => {
  const { service, calls } = fixture({
    ok: true,
    result: { sessionId: 'provider-session-one', cwd: executionCwd },
  });
  await service.create({ ...request, target: { ...request.target, readiness: 'deferred' } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'session.create');
  assert.equal(calls[0][1].readiness, 'deferred');
});

test('create retry keys are stable and scoped to the actor without forwarding actor data', async () => {
  const { service, calls } = fixture({
    ok: true,
    result: { sessionId: 'provider-session-one', cwd: executionCwd },
  });
  await service.create(request);
  await service.create(request);
  await service.create({ ...request, actor: { ...actor, id: 'owner-two' } });

  assert.ok(calls[0][2].idempotencyKey);
  assert.equal(calls[0][2].idempotencyKey, calls[1][2].idempotencyKey);
  assert.notEqual(calls[0][2].idempotencyKey, calls[2][2].idempotencyKey);
  assert.equal(Object.hasOwn(calls[0][1], 'actor'), false);
});

test('missing actor and mismatched capability refuse create before transport dispatch', async () => {
  const { service, calls } = fixture({ ok: true, result: { sessionId: 'must-not-start' } });
  const unauthorized = await service.create({ ...request, actor: { ...actor, id: '' } });
  // Model untrusted JSON without weakening the production request types.
  const denied = await service.execute({
    ...request,
    operation: 'session.create',
    capability: 'session.resume',
  } as unknown as SessionCreateRequest);

  assert.equal(unauthorized.ok, false);
  if (unauthorized.ok) throw new Error('Expected actor validation to refuse create.');
  assert.equal(unauthorized.error.code, 'unauthorized');
  assert.equal(denied.ok, false);
  if (denied.ok) throw new Error('Expected capability validation to refuse create.');
  assert.equal(denied.error.code, 'capability_denied');
  assert.equal(calls.length, 0);
});

test('worktree occupancy and uncertain outcomes return without a retry or root fallback', async () => {
  for (const [code, certainty] of [
    ['worktree_in_use', 'terminal'],
    ['terminal_uncertain', 'uncertain'],
    ['cleanup_pending', 'cleanup_pending'],
  ]) {
    const { service, calls } = fixture({ ok: false, error: { code, message: code } });
    const outcome = await service.create(request);

    assert.equal(outcome.ok, false, code);
    if (outcome.ok) throw new Error(`Expected ${code} to refuse create.`);
    assert.equal(outcome.error.code, code);
    assert.equal(outcome.certainty, certainty);
    assert.equal(calls.length, 1, code);
  }
});

test('resume preserves the selected cwd and refuses a different provider session identity', async () => {
  const resumeRequest = {
    actor,
    capability: 'session.resume' as const,
    requestKey: 'resume-app-session-one',
    target: { sessionId: 'provider-session-one', cwd: executionCwd },
  };
  const { service, calls } = fixture({
    ok: true,
    result: { sessionId: 'provider-session-one', cwd: executionCwd },
  });
  const outcome = await service.resume(resumeRequest);
  assert.equal(calls[0][0], 'session.resume');
  assert.equal(calls[0][1].cwd, executionCwd);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.cwd, executionCwd);

  const mismatched = fixture({
    ok: true,
    result: { sessionId: 'different-provider-session', cwd: executionCwd },
  });
  const refused = await mismatched.service.resume(resumeRequest);
  assert.equal(refused.ok, false);
  if (refused.ok) throw new Error('Expected mismatched resume identity to fail.');
  assert.equal(refused.certainty, 'uncertain');
  assert.equal(refused.error.code, 'malformed_response');
});

test('an unidentifiable create response remains uncertain rather than becoming a usable session', async () => {
  const { service, calls } = fixture({ ok: true, result: { cwd: executionCwd } });
  const outcome = await service.create(request);
  assert.equal(outcome.ok, false);
  if (outcome.ok) throw new Error('Expected a missing provider session identity to fail.');
  assert.equal(outcome.certainty, 'uncertain');
  assert.equal(outcome.error.code, 'malformed_response');
  assert.equal(calls.length, 1);
});
