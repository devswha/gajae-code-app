import { randomUUID } from 'node:crypto';

import type { GjcWorkerOptions, GjcWorkerRun, GjcWorkerWriter } from '../gjc-worker-client.js';
import { sessionsDb, sessionWorktreesDb } from '../modules/database/index.js';
import { resolveProjectRunPermissions } from '../modules/projects/index.js';
import { AppError, createNormalizedMessage } from '../shared/utils.js';

import { getProductionJobOrchestrator, type JobOrchestrator } from './gjc-job-orchestrator.js';
import { validateSessionRepository, validateSessionWorktree } from './session-worktree-paths.js';

type Ticket = { controller: AbortController; aborted: boolean; worker?: GjcWorkerRun; finished?: Promise<void> };
const tickets = new Map<string, Ticket>();

/** Installed synchronously when chat accepts a run, before model lookup. */
export function prepareSessionWorktreeRun(sessionId: string, orchestratorFactory: () => JobOrchestrator = getProductionJobOrchestrator) {
  const row = sessionWorktreesDb.get(sessionId);
  if (!row) return null;
  const ticket: Ticket = { controller: new AbortController(), aborted: false };
  const abortHandle = `session-worktree-${randomUUID()}`;
  tickets.set(abortHandle, ticket);
  return {
    abortHandle,
    get aborted() { return ticket.aborted; },
    dispose() { if (tickets.get(abortHandle) === ticket) tickets.delete(abortHandle); },
    run(message: string, options: GjcWorkerOptions, writer: GjcWorkerWriter): Promise<void> {
      if (ticket.finished) return Promise.reject(new Error('A worktree run ticket can only be used once.'));
      const operation = async () => {
        const signal = ticket.controller.signal;
        const stoppedBeforeAdmission = () => {
          if (!signal.aborted) return false;
          ticket.aborted = true;
          return true;
        };
        if (stoppedBeforeAdmission()) return;
        const session = sessionsDb.getSessionById(sessionId);
        if (!session || session.provider !== 'gjc' || session.project_path !== row.repository_root || session.isArchived) throw new AppError('Session project binding changed.', { code: 'SESSION_PROJECT_MISMATCH', statusCode: 409 });
        await validateSessionRepository(row.repository_root);
        if (stoppedBeforeAdmission()) return;
        const orchestrator = orchestratorFactory();
        const binding = await orchestrator.resolveBinding('gjc', sessionId);
        if (stoppedBeforeAdmission()) return;
        let complete: Record<string, unknown> | undefined;
        const durableWriter: GjcWorkerWriter = {
          userId: writer.userId,
          getAppSessionId: () => writer.getAppSessionId?.(),
          setSessionId: (id) => writer.setSessionId?.(id),
          send: (value) => {
            if (value && typeof value === 'object' && 'kind' in value && value.kind === 'complete') complete = value as Record<string, unknown>;
            else writer.send(value);
          },
        };
        const runOptions = {
          ...options, projectPath: row.repository_root, permissions: resolveProjectRunPermissions(row.repository_root), writer: durableWriter, signal,
          retainWorkspaceOnFailure: true,
          cap: 4,
          onRun: (run: GjcWorkerRun) => { ticket.worker = run; },
        };
        let handle;
        if (!binding) {
          // An existing provider transcript must never be moved to a fresh job
          // merely because its authority binding is missing.
          if (session.provider_session_id || row.worktree_path) throw new AppError('Worktree ownership is unavailable.', { code: 'SESSION_WORKTREE_BINDING_LOST', statusCode: 409 });
          handle = await orchestrator.start('gjc', sessionId, row.repository_root, message, {
            ...runOptions, jobId: row.job_id,
            onPrepared: async (cwd) => {
              await validateSessionWorktree(row, cwd);
              sessionWorktreesDb.setPreparedPath(sessionId, row.job_id, cwd);
            },
          });
        } else {
          if (binding.jobId !== row.job_id || (session.provider_session_id && binding.providerSessionId !== session.provider_session_id)) throw new AppError('Worktree ownership does not match this session.', { code: 'SESSION_WORKTREE_BINDING_MISMATCH', statusCode: 409 });
          if (binding.providerSessionId && !session.provider_session_id) {
            // Recover a crash between native provider binding and app upsert.
            sessionsDb.assignProviderSessionId(sessionId, 'gjc', binding.providerSessionId);
            writer.setSessionId?.(binding.providerSessionId);
          }
          const current = sessionWorktreesDb.get(sessionId);
          if (!current) throw new Error('Session worktree was removed.');
          await validateSessionWorktree(current);
          if (stoppedBeforeAdmission()) return;
          if (binding.state === 'ready') handle = await orchestrator.turnStart('gjc', sessionId, message, runOptions);
          else if (binding.state === 'interrupted') handle = await orchestrator.resume(row.job_id, sessionId, message, runOptions);
          else throw new AppError('This worktree already has an active run.', { code: 'RUN_IN_PROGRESS', statusCode: 409 });
        }
        await handle.completion;
        const outcome = await ticket.worker?.outcome;
        if (outcome === 'unconfirmed') throw new AppError('Worktree execution has not confirmed termination.', { code: 'SESSION_WORKTREE_STOP_UNCONFIRMED', statusCode: 409 });
        ticket.aborted = signal.aborted || outcome === 'aborted';
        // Let queued chat follow-ups start only after native authority is ready.
        writer.send(createNormalizedMessage({ ...complete, kind: 'complete', provider: 'gjc', sessionId: sessionsDb.getSessionById(sessionId)?.provider_session_id ?? sessionId, exitCode: complete?.exitCode ?? 0, aborted: ticket.aborted }));
      };
      const finished = operation();
      ticket.finished = finished;
      return finished;
    },
  };
}

export function sessionWorktreeWorkerHandle(handle: string): string | undefined {
  return tickets.get(handle)?.worker?.abortHandle;
}

export async function abortSessionWorktreeRun(handle: string): Promise<boolean | null> {
  const ticket = tickets.get(handle);
  if (!ticket) return null;
  ticket.controller.abort();
  // Before model lookup completes, no native work has started. Once preparation
  // starts, wait for its cancellation too so the next turn sees a ready binding.
  if (!ticket.finished) { ticket.aborted = true; return true; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ticket.finished.catch(() => {}).then(async () => {
        if (!ticket.worker) return true;
        if (!ticket.worker.outcome) return ticket.worker.completion.then(() => true, () => false);
        const outcome = await ticket.worker.outcome.catch(() => 'unconfirmed');
        return outcome !== 'unconfirmed';
      }),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 5000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
