export type GjcGoalOperation = 'create' | 'get' | 'pause' | 'resume' | 'complete' | 'drop';
export type GjcGoalScope = { appSessionId: string; owner: string; cwd: string; projectPath?: string };
export type GjcGoal = {
  id: string;
  objective: string;
  status: 'active' | 'paused' | 'complete' | 'dropped';
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
  provenance?: { source: 'user' } | { source: 'ultragoal'; runId: string; goalId: string };
};
export type GjcGoalState = { enabled: boolean; mode: 'active' | 'exiting'; goal: GjcGoal };
export type GjcGoalSnapshot = {
  supported: boolean;
  goal: GjcGoal | null;
  runId: string | null;
  canControl: boolean;
  /** An idle transcript never implies that an autonomous worker is running. */
  resumeRequired: boolean;
};
export type GjcGoalCommand = { operation: Exclude<GjcGoalOperation, 'get'>; goalId: string | null; objective?: string };
export const GJC_GOAL_MAX_OBJECTIVE = 8_000;
export const GJC_GOAL_RUN_LIMIT_MS = 15 * 60 * 1_000;
export const GJC_GOAL_TURN_LIMIT = 20;

export function normalizeGjcGoal(value: unknown): GjcGoal | null {
  if (!value || typeof value !== 'object') return null;
  const goal = value as Record<string, unknown>;
  if (typeof goal.id !== 'string' || !goal.id || typeof goal.objective !== 'string' || !goal.objective.trim()
    || !['active', 'paused', 'complete', 'dropped'].includes(String(goal.status))) return null;
  for (const field of ['tokensUsed', 'timeUsedSeconds', 'createdAt', 'updatedAt']) {
    if (typeof goal[field] !== 'number' || !Number.isFinite(goal[field]) || goal[field] < 0) return null;
  }
  if (goal.provenance !== undefined) {
    if (!goal.provenance || typeof goal.provenance !== 'object') return null;
    const provenance = goal.provenance as Record<string, unknown>;
    if (provenance.source !== 'user' && !(provenance.source === 'ultragoal' && typeof provenance.runId === 'string' && typeof provenance.goalId === 'string')) return null;
  }
  return Object.fromEntries(['id', 'objective', 'status', 'tokensUsed', 'timeUsedSeconds', 'createdAt', 'updatedAt', ...(goal.provenance ? ['provenance'] : [])].map((key) => [key, goal[key]])) as GjcGoal;
}

export function normalizeGjcGoalState(value: unknown): GjcGoalState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = value as Record<string, unknown>;
  const goal = normalizeGjcGoal(state.goal);
  if (!goal || typeof state.enabled !== 'boolean' || (state.mode !== 'active' && state.mode !== 'exiting')) return undefined;
  return { enabled: state.enabled, mode: state.mode, goal };
}

export function parseGjcGoalCommand(value: unknown): GjcGoalCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid goal command.');
  const command = value as Record<string, unknown>;
  if (Object.keys(command).some((key) => !['operation', 'goalId', 'objective'].includes(key))
    || !['create', 'pause', 'resume', 'complete', 'drop'].includes(String(command.operation))
    || !(command.goalId === null || (typeof command.goalId === 'string' && command.goalId.length > 0 && command.goalId.length <= 120))) throw new Error('Invalid goal command.');
  if (command.operation === 'create') {
    if (command.goalId !== null || typeof command.objective !== 'string' || !command.objective.trim()
      || command.objective.length > GJC_GOAL_MAX_OBJECTIVE) throw new Error('Enter a goal objective (up to 8,000 characters).');
  } else if (!command.goalId || command.objective !== undefined) throw new Error('Goal controls require the current goal ID.');
  return command as GjcGoalCommand;
}
