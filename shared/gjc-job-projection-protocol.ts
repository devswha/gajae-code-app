export const GJC_JOB_PROJECTION_PROTOCOL_VERSION = 1 as const;

type JobSequence = number;
export type JobState = 'reserved' | 'queued' | 'running' | 'aborting' | 'ready' | 'succeeded' | 'failed' | 'aborted' | 'interrupted';
export type JobProjectionEvent = { eventId: string; sequence: JobSequence; payload: unknown };
export type JobSnapshot = {
  jobId: string;
  provider: 'gjc';
  state: JobState;
  createdAt?: string;
  prompt?: string | null;
  lastSequence: JobSequence;
  worktreeId?: string;
  branch?: string;
  repositoryRoot?: string;
  baseCommit?: string;
  currentRun?: { runId: string; appSessionId?: string; providerSessionId?: string };
};
/** Canonical HTTP response for a managed job's UTF-8 git diff. */
export type JobGitDiffResponse = { text: string; paths: string[] };

export type JobProjectionErrorCode = 'invalid_request' | 'not_found' | 'cursor_ahead' | 'cursor_mismatch' | 'authority_unavailable' | 'storage_failure' | 'buffer_overflow' | 'protocol_violation';
/** The WebSocket client sends `type`; server frames use `kind`. */
export type JobProjectionInboundFrame =
  | { protocolVersion: 1; type: 'gjc.job.subscribe'; jobId: string; after?: JobSequence }
  | { protocolVersion: 1; type: 'gjc.job.replay'; jobId: string; subscriptionId: string; after: JobSequence; byteBudget?: number }
  | { protocolVersion: 1; type: 'gjc.job.unsubscribe'; jobId: string; subscriptionId: string };
export type JobProjectionOutboundFrame =
  | { protocolVersion: 1; kind: 'gjc_job_subscribed'; subscriptionId: string; jobId: string; cursor: JobSequence; watermark: JobSequence; snapshot: JobSnapshot }
  | { protocolVersion: 1; kind: 'gjc_job_replay_chunk'; subscriptionId: string; jobId: string; after: JobSequence; watermark: JobSequence; events: JobProjectionEvent[]; nextCursor: JobSequence | null; done: boolean }
  | { protocolVersion: 1; kind: 'gjc_job_event'; subscriptionId: string; jobId: string; event: JobProjectionEvent }
  | { protocolVersion: 1; kind: 'gjc_job_unsubscribed'; subscriptionId: string; jobId: string }
  | { protocolVersion: 1; kind: 'gjc_job_error'; code: JobProjectionErrorCode; subscriptionId?: string; jobId?: string; retryable: boolean; message: string };

export type JobTerminalOutcome = 'succeeded' | 'failed' | 'aborted' | 'interrupted';
export type JobTerminalPayload = {
  schemaVersion: 1;
  kind: 'job_terminal';
  runId: string;
  appSessionId?: string;
  outcome: JobTerminalOutcome;
  jobState: Extract<JobState, JobTerminalOutcome>;
  reason: string;
};

const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/u;
const TERMINAL_STATES = new Set<JobTerminalOutcome>(['succeeded', 'failed', 'aborted', 'interrupted']);
const ERROR_CODES = new Set<JobProjectionErrorCode>(['invalid_request', 'not_found', 'cursor_ahead', 'cursor_mismatch', 'authority_unavailable', 'storage_failure', 'buffer_overflow', 'protocol_violation']);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function isJobSequence(value: unknown): value is JobSequence { return Number.isSafeInteger(value) && (value as number) >= 0; }
function isJobIdentifier(value: unknown): value is string { return typeof value === 'string' && IDENTIFIER.test(value); }
export function isJobProjectionEvent(value: unknown): value is JobProjectionEvent {
  return object(value) && isJobIdentifier(value.eventId) && isJobSequence(value.sequence) && value.sequence >= 1 && 'payload' in value;
}
export function isJobProjectionInboundFrame(value: unknown): value is JobProjectionInboundFrame {
  if (!object(value) || value.protocolVersion !== GJC_JOB_PROJECTION_PROTOCOL_VERSION || !isJobIdentifier(value.jobId)) return false;
  if (value.type === 'gjc.job.subscribe') return value.after === undefined || isJobSequence(value.after);
  if (value.type === 'gjc.job.replay') return isJobIdentifier(value.subscriptionId) && isJobSequence(value.after) && (value.byteBudget === undefined || isJobSequence(value.byteBudget));
  return value.type === 'gjc.job.unsubscribe' && isJobIdentifier(value.subscriptionId);
}
export function isJobProjectionOutboundFrame(value: unknown): value is JobProjectionOutboundFrame {
  if (!object(value) || value.protocolVersion !== GJC_JOB_PROJECTION_PROTOCOL_VERSION) return false;
  if (value.kind === 'gjc_job_error') return typeof value.code === 'string' && ERROR_CODES.has(value.code as JobProjectionErrorCode) && typeof value.retryable === 'boolean' && typeof value.message === 'string';
  if (!isJobIdentifier(value.jobId) || !isJobIdentifier(value.subscriptionId)) return false;
  if (value.kind === 'gjc_job_subscribed') return isJobSequence(value.cursor) && isJobSequence(value.watermark) && object(value.snapshot);
  if (value.kind === 'gjc_job_replay_chunk') return isJobSequence(value.after) && isJobSequence(value.watermark) && Array.isArray(value.events) && value.events.every(isJobProjectionEvent) && (value.nextCursor === null || isJobSequence(value.nextCursor)) && typeof value.done === 'boolean';
  if (value.kind === 'gjc_job_event') return isJobProjectionEvent(value.event);
  return value.kind === 'gjc_job_unsubscribed';
}

function boundedReason(value: unknown): string {
  const source = typeof value === 'string' ? value : 'completed';
  return source.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 512) || 'completed';
}
export function jobTerminalEventId(runId: string): string { return `run-terminal:${runId}`; }
export function createJobTerminalPayload(input: { runId: string; appSessionId?: string | null; outcome: JobTerminalOutcome; reason?: unknown }): JobTerminalPayload {
  if (!isJobIdentifier(input.runId) || !TERMINAL_STATES.has(input.outcome)) throw new Error('Invalid terminal event input.');
  return { schemaVersion: 1, kind: 'job_terminal', runId: input.runId, ...(input.appSessionId ? { appSessionId: input.appSessionId } : {}), outcome: input.outcome, jobState: input.outcome, reason: boundedReason(input.reason) };
}
