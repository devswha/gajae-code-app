import { realpath } from 'node:fs/promises';

import { projectsDb, sessionsDb, sessionWorktreesDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';

import { parseGjcGoalCommand, type GjcGoalCommand, type GjcGoalSnapshot, type GjcGoalScope } from '../../../../shared/gjc-goal.js';
import type { SessionWorktreeRuntime } from '../../../../shared/session-worktree-protocol.js';

export type GoalSupervisor = {
  inspectGoal(scope: GjcGoalScope, providerSessionId: string): Promise<GjcGoalSnapshot>;
  controlGoal(runId: string, scope: GjcGoalScope, command?: GjcGoalCommand, stopAfterMutation?: boolean): Promise<GjcGoalSnapshot>;
};
type GoalRequest = Record<string, unknown>;

/** The browser never supplies a cwd, provider identity, owner, or SDK run options. */
export async function handleChatGoal(
  userId: string | number | null,
  data: GoalRequest,
  supervisor: GoalSupervisor,
  start: (sessionId: string, command: GjcGoalCommand) => Promise<void>,
  worktrees?: SessionWorktreeRuntime,
): Promise<GjcGoalSnapshot | { started: true }> {
  if (userId === null) throw new Error('Sign in to control goals.');
  if (typeof data.sessionId !== 'string' || typeof data.projectId !== 'string') throw new Error('A session and project are required.');
  const row = sessionsDb.getSessionById(data.sessionId);
  if (!row || row.provider !== 'gjc' || !row.project_path || row.isArchived) throw new Error('The goal session is unavailable.');
  const project = projectsDb.getProjectPath(row.project_path);
  if (!project || project.project_id !== data.projectId || project.isArchived) throw new Error('The goal does not belong to this project.');
  const binding = sessionWorktreesDb.get(row.session_id);
  if (binding && binding.repository_root !== row.project_path) throw new Error('The worktree belongs to another project.');
  const readScope = async (): Promise<GjcGoalScope> => {
    const projectPath = await realpath(row.project_path!);
    const cwd = binding ? await worktrees?.resolveWorkspace?.(data.projectId as string, row.session_id) : projectPath;
    if (!cwd) throw new Error('The worktree execution directory is unavailable.');
    return { appSessionId: row.session_id, cwd, owner: `${typeof userId}:${userId}`, ...(binding ? { projectPath } : {}) };
  };
  const run = chatRunRegistry.getRun(row.session_id);
  const active = run?.status === 'running' ? run : undefined;
  const abortHandle = active?.writer.getAbortHandle() ?? null;
  // Live goal snapshots use the worker ID. The enclosing worktree ticket is
  // retained only for cancellation through native job ownership.
  const runId = binding && abortHandle ? worktrees?.workerHandle(abortHandle) ?? null : abortHandle;
  if (active && active.writer.userId !== userId) throw new Error('Only the run owner can control this goal.');
  const command = data.operation === 'get' ? undefined : parseGjcGoalCommand({
    operation: data.operation, goalId: data.goalId, ...(data.objective === undefined ? {} : { objective: data.objective }),
  });
  if (command && data.runId !== runId) throw new Error('The active run changed. Refresh before controlling its goal.');
  if (active) {
    if (!runId) throw new Error('The run is still starting. Try again shortly.');
    const scope = await readScope();
    if (!binding || (command?.operation !== 'pause' && command?.operation !== 'drop')) return supervisor.controlGoal(runId, scope, command);
    const snapshot = await supervisor.controlGoal(runId, scope, command, false);
    const stopped = await worktrees!.abort(abortHandle!);
    if (stopped !== true && active.status === 'running') throw new Error('The goal changed, but worktree termination could not be confirmed.');
    return { ...snapshot, runId: null, canControl: true, resumeRequired: command.operation === 'pause' };
  }
  const snapshot: GjcGoalSnapshot = row.provider_session_id
    ? await supervisor.inspectGoal(await readScope(), row.provider_session_id)
    : { supported: true, goal: null, runId: null, canControl: true, resumeRequired: false };
  if (!command) return snapshot;
  if (!snapshot.canControl) throw new Error('This goal belongs to another session owner.');
  if ((snapshot.goal?.id ?? null) !== command.goalId && !(command.operation === 'create' && snapshot.goal?.status === 'complete')) throw new Error('The goal changed. Refresh before controlling it.');
  // sendChat reserves the run synchronously before its first await. The SDK
  // repeats goal-ID/owner checks after opening the exact persisted session.
  if (chatRunRegistry.isProcessing(row.session_id)) throw new Error('The session started another run. Refresh first.');
  await start(row.session_id, command);
  return { started: true };
}
