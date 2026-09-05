import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatGoal, type GoalSupervisor } from '@/modules/websocket/services/chat-goal.service.js';

test('goal controls enforce owner, project, exact run and goal identities before forwarding', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'gajae-goal-owner-'));
  const previous = process.env.DATABASE_PATH;
  closeConnection();
  process.env.DATABASE_PATH = path.join(root, 'test.sqlite');
  try {
    await initializeDatabase();
    const cwd = await realpath(root);
    sessionsDb.createAppSession('goal-app', 'gjc', cwd);
    sessionsDb.assignProviderSessionId('goal-app', 'gjc', 'provider-goal');
    const projectId = projectsDb.getProjectPath(cwd)!.project_id;
    const calls: unknown[] = [];
    const goal = { id: 'goal-a', objective: 'Scoped work', status: 'paused' as const, tokensUsed: 5, timeUsedSeconds: 1, createdAt: 1, updatedAt: 2 };
    const snapshot = { supported: true, goal, runId: null, canControl: true, resumeRequired: false };
    const supervisor: GoalSupervisor = {
      inspectGoal: async (...args) => { calls.push(args); return snapshot; },
      controlGoal: async (...args) => { calls.push(args); return snapshot; },
    };
    const request = { sessionId: 'goal-app', projectId, operation: 'resume', goalId: 'goal-a', runId: null };
    const start = async (...args: unknown[]) => { calls.push(args); };
    await assert.rejects(handleChatGoal(null, request, supervisor, start), /Sign in/);
    await assert.rejects(handleChatGoal(1, { ...request, projectId: 'wrong' }, supervisor, start), /project/);
    assert.equal(calls.length, 0);
    await assert.rejects(handleChatGoal(1, { ...request, goalId: 'stale' }, supervisor, start), /goal changed/);
    assert.equal(calls.length, 1);
    snapshot.canControl = false;
    await assert.rejects(handleChatGoal(2, request, supervisor, start), /another session owner/);
    snapshot.canControl = true;
    const run = chatRunRegistry.startRun({ appSessionId: 'goal-app', provider: 'gjc', providerSessionId: 'provider-goal', userId: 1, connection: { readyState: 1, send() {} } });
    assert.ok(run);
    run.writer.setAbortHandle('exact-run');
    await assert.rejects(handleChatGoal(2, { ...request, runId: 'exact-run' }, supervisor, start), /run owner/);
    await assert.rejects(handleChatGoal(1, request, supervisor, start), /active run changed/);
    await handleChatGoal(1, { ...request, runId: 'exact-run' }, supervisor, start);
    assert.deepEqual(calls.at(-1), ['exact-run', { appSessionId: 'goal-app', cwd, owner: 'number:1' }, { operation: 'resume', goalId: 'goal-a' }]);
  } finally {
    chatRunRegistry.completeRun('goal-app', { exitCode: 0 });
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});
