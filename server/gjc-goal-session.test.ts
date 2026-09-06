import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { GJC_GOAL_RUN_LIMIT_MS, GJC_GOAL_TURN_LIMIT, type GjcGoalOperation, type GjcGoalState } from '../shared/gjc-goal.js';

import { GjcGoalSession, readPersistedGjcGoal } from './gjc-goal-session.js';

/** Only the public goal lifecycle surface; no SDK, skill discovery or provider calls. */
async function fixture() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'gajae-goal-limits-')));
  let state: GjcGoalState | undefined;
  let nextId = 0;
  let stops = 0;
  let aborts = 0;
  let persisted: GjcGoalState | undefined;
  const entries: ReturnType<ConstructorParameters<typeof GjcGoalSession>[1]['getBranch']> = [];
  const manager = {
    getCwd: () => cwd,
    getBranch: () => entries,
    appendCustomEntry: (customType: string, data: unknown) => { entries.push({ type: 'custom', customType, data }); },
    flush: async () => { persisted = structuredClone(readPersistedGjcGoal(manager).state); },
  };
  const session = {
    getGoalModeState: () => state,
    setGoalModeState: (value: GjcGoalState | undefined) => { state = value; },
    operateGoal: async (operation: GjcGoalOperation) => {
      if (operation === 'get') return state;
      if (operation === 'create') {
        state = { enabled: true, mode: 'active', goal: {
          id: `goal-${++nextId}`, objective: 'Bounded ordinary work', status: 'active',
          tokensUsed: 0, timeUsedSeconds: 0, createdAt: Date.now(), updatedAt: Date.now(),
        } };
      } else {
        assert.ok(state);
        const status = operation === 'resume' ? 'active' : operation === 'pause' ? 'paused' : 'complete';
        state = { ...state, enabled: status === 'active', mode: status === 'complete' ? 'exiting' : 'active', goal: { ...state.goal, status } };
      }
      entries.push({ type: 'mode_change', mode: state.goal.status === 'paused' ? 'goal_paused' : 'goal', data: { goal: state.goal } });
      goals.onEvent({ type: 'goal_updated', goal: state.goal, state });
      return state;
    },
    abort: async () => { aborts++; },
  };
  const goals = new GjcGoalSession(session, manager, { appSessionId: 'app', owner: 'number:1', cwd }, 'run', () => {}, async () => {
    stops++;
    await goals.stop();
  });
  await goals.restore();
  return {
    goals, stops: () => stops, aborts: () => aborts, persisted: () => persisted,
    tool: (operation: GjcGoalOperation) => goals.invokeTool(operation, () => session.operateGoal(operation)),
    close: async () => { await goals.dispose(); await rm(cwd, { recursive: true, force: true }); },
  };
}

test('ordinary goal pause/resume retains the original elapsed-time deadline', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const f = await fixture();
  try {
    await f.tool('create');
    t.mock.timers.tick(GJC_GOAL_RUN_LIMIT_MS - 1000);
    await f.tool('pause');
    t.mock.timers.tick(500);
    await f.tool('resume');
    t.mock.timers.tick(499);
    assert.equal(f.stops(), 0);
    t.mock.timers.tick(1);
    assert.equal(f.stops(), 1, 'resume cannot buy a new run budget');
    await f.goals.stop();
    assert.equal(f.aborts(), 1);
    assert.equal(f.persisted()?.goal.status, 'paused');
    assert.equal(f.persisted()?.enabled, false);
    await assert.rejects(f.tool('resume'), /app goal controls/);
  } finally { await f.close(); }
});

test('ordinary replacement goals share the elapsed-time budget and cannot revive an expired run', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const f = await fixture();
  try {
    await f.tool('create');
    const originalId = f.goals.snapshot().goal!.id;
    t.mock.timers.tick(GJC_GOAL_RUN_LIMIT_MS - 1);
    await f.tool('complete');
    t.mock.timers.tick(1);
    assert.equal(f.stops(), 0, 'completing the goal cancels its active timer');
    await f.tool('create');
    assert.notEqual(f.goals.snapshot().goal!.id, originalId);
    assert.equal(f.stops(), 1, 'a replacement cannot renew an exhausted run');
    await f.goals.stop();
    assert.equal(f.persisted()?.goal.status, 'paused');
    assert.equal(f.goals.snapshot().canControl, false);
  } finally { await f.close(); }
});

test('ordinary goal turn limits survive pause/resume and replacement and stop exactly once', async () => {
  const f = await fixture();
  try {
    await f.tool('create');
    for (let i = 0; i < GJC_GOAL_TURN_LIMIT - 2; i++) f.goals.onEvent({ type: 'turn_end' });
    await f.tool('pause');
    for (let i = 0; i < GJC_GOAL_TURN_LIMIT; i++) f.goals.onEvent({ type: 'turn_end' });
    assert.equal(f.stops(), 0, 'paused work does not consume autonomous turns');
    await f.tool('resume');
    f.goals.onEvent({ type: 'turn_end' });
    await f.tool('complete');
    await f.tool('create');
    assert.equal(f.stops(), 0);
    f.goals.onEvent({ type: 'turn_end' });
    assert.equal(f.stops(), 1, 'the final available turn stops the whole run');
    f.goals.onEvent({ type: 'turn_end' });
    await f.goals.stop();
    assert.equal(f.stops(), 1);
    assert.equal(f.aborts(), 1);
    assert.equal(f.persisted()?.goal.status, 'paused');
  } finally { await f.close(); }
});
