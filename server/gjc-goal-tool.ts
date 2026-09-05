import type { CustomTool } from '@gajae-code/coding-agent/extensibility/custom-tools/types';

import { parseGjcGoalCommand, type GjcGoalOperation } from '../shared/gjc-goal.js';

import type { GjcGoalSession } from './gjc-goal-session.js';

type BuiltinGoalTool = {
  name: string; label: string; description: string; parameters: CustomTool['parameters'];
  execute(id: string, params: unknown, signal?: AbortSignal, update?: unknown): Promise<unknown>;
};
type GoalToolHost = {
  getToolByName(name: string): BuiltinGoalTool | undefined;
  replaceNamedCustomTools(names: readonly string[], tools: CustomTool[]): Promise<void>;
};

export async function installGjcGoalTool(session: GoalToolHost, goals: GjcGoalSession): Promise<void> {
  const builtin = session.getToolByName('goal');
  if (!builtin) throw new Error('The SDK goal tool is unavailable.');
  await session.replaceNamedCustomTools(['goal'], [{
    name: 'goal', label: builtin.label, description: builtin.description,
    parameters: builtin.parameters, strict: true, concurrency: 'exclusive',
    execute: (id, params, update, _context, signal) => {
      const input = params as { op: GjcGoalOperation; objective?: string };
      if (input.op === 'create') parseGjcGoalCommand({ operation: 'create', goalId: null, objective: input.objective });
      return goals.invokeTool(input.op, () => builtin.execute(id, params, signal, update)) as ReturnType<CustomTool['execute']>;
    },
  }]);
}
