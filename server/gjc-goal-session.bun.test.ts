import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createAgentSession } from '@gajae-code/coding-agent/sdk/session';
import { Settings } from '@gajae-code/coding-agent/config/settings';
import { SessionManager } from '@gajae-code/coding-agent/session/session-manager';
import { getUltragoalPaths } from '@gajae-code/coding-agent/gjc-runtime/ultragoal-runtime';

import { GJC_GOAL_TURN_LIMIT, type GjcGoalSnapshot, type GjcGoalOperation } from '../shared/gjc-goal.js';

import { GjcGoalSession, GJC_GOAL_MODEL_OPERATIONS, readPersistedGjcGoal } from './gjc-goal-session.js';
import { installGjcGoalTool } from './gjc-goal-tool.js';
import { forwardSdkEvent, type SdkRunState } from './gjc-bun-sdk-events.js';
import { readSessionSnapshot } from './gjc-session-state.js';

async function fixture(modelOperations: readonly GjcGoalOperation[] = GJC_GOAL_MODEL_OPERATIONS) {
  const root = await mkdtemp(join(tmpdir(), 'gajae-goal-sdk-'));
  const cwd = await realpath(root);
  const agentDir = join(cwd, 'agent');
  await mkdir(agentDir);
  const settings = Settings.isolated({ 'goal.enabled': true });
  const manager = SessionManager.create(cwd, SessionManager.managedDestination(cwd, agentDir));
  manager.appendMessage({ role: 'user', content: 'Goal lifecycle test; never prompt a model.', timestamp: Date.now() });
  await manager.flush();
  const result = await createAgentSession({
    cwd, agentDir, sessionManager: manager, settings, disableExtensionDiscovery: true,
    skills: [], contextFiles: [], promptTemplates: [], slashCommands: [], enableMCP: false,
    enableLsp: false, toolNames: ['goal'], spawns: 'deny', goalToolAllowedOps: modelOperations,
  });
  const snapshots: GjcGoalSnapshot[] = [];
  let stops = 0;
  const scope = { appSessionId: 'app-goal', owner: 'number:1', cwd };
  const goals = new GjcGoalSession(result.session, manager, scope, 'run-goal', (snapshot) => snapshots.push(snapshot), async () => { stops++; await goals.stop(); }, modelOperations);
  const unsubscribe = result.session.subscribe((event: unknown) => goals.onEvent(event));
  await goals.restore();
  await installGjcGoalTool(result.session, goals);
  return { root, cwd, manager, session: result.session, goals, scope, snapshots, stops: () => stops, close: async () => {
    unsubscribe(); await goals.dispose(); await result.session.dispose(); await rm(root, { recursive: true, force: true });
  } };
}

test('real SDK goal create, pause, resume, complete and drop persist authoritative mode changes without model calls', async () => {
  const f = await fixture();
  try {
    const created = await f.goals.control({ operation: 'create', goalId: null, objective: 'Finish the scoped change' });
    const id = created.goal!.id;
    assert.equal(created.goal?.status, 'active');
    assert.equal(created.goal?.tokensUsed, 0);
    assert.deepEqual(readPersistedGjcGoal(f.manager).scope, f.scope);
    await f.goals.control({ operation: 'pause', goalId: id });
    assert.equal(readPersistedGjcGoal(f.manager).state?.goal.status, 'paused');
    await f.goals.control({ operation: 'resume', goalId: id });
    assert.equal(f.session.getGoalModeState()?.enabled, true);
    await f.goals.control({ operation: 'complete', goalId: id });
    assert.equal(readPersistedGjcGoal(f.manager).state?.goal.status, 'complete');
    await f.goals.control({ operation: 'drop', goalId: id });
    assert.equal(f.session.getGoalModeState(), undefined);
    assert.equal(readPersistedGjcGoal(f.manager).state, undefined);
    assert.equal(f.manager.getBranch().filter((entry: { type: string }) => entry.type === 'message').length, 1);
  } finally { await f.close(); }
});

test('real goal tool respects operation restrictions and shares the app scope while retaining SDK guards', async () => {
  const f = await fixture(['get', 'pause', 'complete']);
  try {
    const created = await f.goals.control({ operation: 'create', goalId: null, objective: 'A user-authorized goal' });
    const tool = f.session.getToolByName('goal')!;
    await assert.rejects(tool.execute('create', { op: 'create', objective: 'Unapproved replacement' }), /app goal controls/);
    await assert.rejects(tool.execute('resume', { op: 'resume' }), /app goal controls/);
    const read = await tool.execute('get', { op: 'get' });
    assert.equal(read.details.goal.id, created.goal!.id);
    await tool.execute('pause', { op: 'pause' });
    assert.equal(readPersistedGjcGoal(f.manager).state?.goal.status, 'paused');
    await f.goals.control({ operation: 'resume', goalId: created.goal!.id });
    await tool.execute('complete', { op: 'complete' });
    assert.equal(f.session.getGoalModeState()?.goal.status, 'complete');
    await assert.rejects(tool.execute('drop', { op: 'drop' }), /app goal controls/);
  } finally { await f.close(); }
});

test('real model goal create/resume and pending skill activation receive ownership and the same turn limit', async () => {
  const f = await fixture();
  try {
    const tool = f.session.getToolByName('goal')!;
    await tool.execute('model-create', { op: 'create', objective: 'A model-created scoped goal' });
    assert.deepEqual(readPersistedGjcGoal(f.manager).scope, f.scope);
    for (let i = 0; i < GJC_GOAL_TURN_LIMIT / 2; i++) f.goals.onEvent({ type: 'turn_end' });
    await tool.execute('model-pause', { op: 'pause' });
    await tool.execute('model-resume', { op: 'resume' });
    for (let i = 0; i < GJC_GOAL_TURN_LIMIT / 2; i++) f.goals.onEvent({ type: 'turn_end' });
    await f.goals.stop();
    assert.equal(f.stops(), 1);
    assert.equal(f.session.getGoalModeState()?.goal.status, 'paused');
  } finally { await f.close(); }
  const skill = await fixture();
  try {
    await skill.session.goalRuntime.createGoal({ objective: 'A pending SDK skill goal' });
    assert.deepEqual(readPersistedGjcGoal(skill.manager).scope, skill.scope);
    for (let i = 0; i < GJC_GOAL_TURN_LIMIT; i++) skill.goals.onEvent({ type: 'turn_end' });
    await skill.goals.stop();
    assert.equal(skill.stops(), 1);
    assert.equal(readPersistedGjcGoal(skill.manager).state?.goal.status, 'paused');
  } finally { await skill.close(); }
});

test('real model-facing goal tool cannot complete an unverifiable ultragoal, while explicit human cancellation remains available', async () => {
  const f = await fixture();
  try {
    await f.goals.control({ operation: 'create', goalId: null, objective: 'Verify the durable workflow' });
    const state = f.session.getGoalModeState()!;
    const provenance = { source: 'ultragoal' as const, runId: f.manager.getSessionId(), goalId: 'aggregate' };
    f.session.setGoalModeState({ ...state, goal: { ...state.goal, provenance } });
    f.manager.appendModeChange('goal', { goal: f.session.getGoalModeState()!.goal });
    assert.deepEqual(readPersistedGjcGoal(f.manager).state?.goal.provenance, provenance);
    const paths = getUltragoalPaths(f.cwd, f.manager.getSessionId());
    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.goalsPath, '{malformed');
    await assert.rejects(f.session.getToolByName('goal')!.execute('premature-complete', { op: 'complete' }), /Ultragoal|ultragoal|durable|JSON|verification/);
    assert.equal(f.session.getGoalModeState()?.goal.status, 'active');
    await f.goals.control({ operation: 'drop', goalId: state.goal.id });
    assert.equal(f.session.getGoalModeState(), undefined);
  } finally { await f.close(); }
});

test('stop persists pause, reload never starts continuation, and foreign owners cannot hydrate goals', async () => {
  const f = await fixture();
  try {
    const created = await f.goals.control({ operation: 'create', goalId: null, objective: 'Keep the session stopped' });
    await f.goals.stop();
    assert.equal(f.session.getGoalModeState()?.goal.status, 'paused');
    await f.manager.flush();
    const reopened = await SessionManager.open(f.manager.getSessionFile()!);
    try { assert.equal(readPersistedGjcGoal(reopened).state?.goal.id, created.goal!.id); }
    finally { await reopened.close(); }
    const foreign = new GjcGoalSession(f.session, f.manager, { ...f.scope, owner: 'number:2' }, 'foreign', () => {}, async () => {});
    await assert.rejects(foreign.restore(), /another session owner/);
    await foreign.dispose();
  } finally { await f.close(); }
});

test('SDK pending goal activation cannot bypass app controls, and turn limit stops active work', async () => {
  const f = await fixture();
  try {
    await f.goals.control({ operation: 'create', goalId: null, objective: 'Bounded work' });
    for (let i = 0; i < GJC_GOAL_TURN_LIMIT; i++) f.goals.onEvent({ type: 'turn_end' });
    await f.goals.stop();
    assert.equal(f.stops(), 1);
    assert.equal(f.session.getGoalModeState()?.goal.status, 'paused');
  } finally { await f.close(); }
  const other = await fixture(['get', 'pause', 'complete']);
  try {
    // This is the SDK pending-skill path, which calls GoalRuntime directly
    // rather than GoalTool and therefore ignores goalToolAllowedOps.
    await other.session.goalRuntime.createGoal({ objective: 'Unadmitted skill activation' });
    await other.goals.stop();
    assert.equal(other.stops(), 1);
    assert.equal(other.session.getGoalModeState()?.goal.status, 'paused');
  } finally { await other.close(); }
});

test('goal_updated fan-in handles completion/drop event data and rejects malformed goal state', async () => {
  const f = await fixture();
  try {
    await f.goals.control({ operation: 'create', goalId: null, objective: 'Project real SDK state' });
    const frames: Array<Record<string, any>> = [];
    const state: SdkRunState = { abortRequested: false, abortPending: false, terminalEmitted: false, finalError: false };
    const unsubscribe = f.session.subscribe((event: unknown) => forwardSdkEvent(event, { send: (value) => frames.push(value as Record<string, any>) }, state, () => ({ ...readSessionSnapshot(f.session, f.manager), goal: f.goals.snapshot() })));
    await f.goals.control({ operation: 'drop', goalId: f.goals.snapshot().goal!.id });
    unsubscribe();
    assert.equal(frames.at(-1)?.sessionState.goal.goal.status, 'dropped');
    assert.equal(f.goals.snapshot().goal, null);
    const before = frames.length;
    forwardSdkEvent({ type: 'goal_updated', goal: { id: 'bad' } }, { send: (value) => frames.push(value as Record<string, any>) }, state);
    assert.equal(frames.length, before);
  } finally { await f.close(); }
});
