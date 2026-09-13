import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { DelegationSnapshot, NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';

export type SessionDelegation = DelegationSnapshot;

const EMPTY_MESSAGES: NormalizedMessage[] = [];
const EMPTY_DELEGATIONS: SessionDelegation[] = [];

const STATUSES = new Set(['running', 'completed', 'failed', 'cancelled']);
const EXECUTION_MODES = new Set(['default', 'ultragoal-red-team']);

const isDelegationToolName = (toolName: string | undefined) => toolName === 'task' || toolName === 'subagent';

/**
 * Accepts only a fully formed public snapshot. A row that is missing the
 * identity, the agent or the settlement status carries no truth about what is
 * running, so it is dropped rather than rendered as a half-known agent.
 */
const snapshotFrom = (candidate: unknown, idKey: 'id' | 'delegationId'): SessionDelegation | null => {
  if (!candidate || typeof candidate !== 'object') return null;
  const row = candidate as Record<string, unknown>;
  const delegationId = row[idKey];
  const { status, agent, description, executionMode, repositoryBinding } = row;
  if (typeof delegationId !== 'string' || !delegationId) return null;
  if (typeof status !== 'string' || !STATUSES.has(status)) return null;
  if (typeof agent !== 'string' || !agent) return null;
  if (typeof description !== 'string') return null;
  return {
    delegationId,
    status: status as SessionDelegation['status'],
    agent,
    description,
    ...(typeof executionMode === 'string' && EXECUTION_MODES.has(executionMode)
      ? { executionMode: executionMode as SessionDelegation['executionMode'] }
      : {}),
    ...(repositoryBinding !== undefined ? { repositoryBinding } : {}),
  };
};

/**
 * The session's App-owned delegations, folded from the message window in
 * array order (the store merges chronologically), last write per delegation
 * wins.
 *
 * Exactly two sources are authoritative: the `subagents` array the delegation
 * tool returns in its structured result, and the `delegation_updated`
 * settlement rows the executor emits per receipt. The result reaches the
 * window in two shapes: the reloaded transcript attaches it to its `tool_use`
 * row, while the live stream carries it as a standalone `tool_result` row that
 * only a shared `toolId` ties back to the call. Nothing is inferred from
 * timing, prose or tool counts, and a terminal state is not sticky - a resume
 * legitimately reuses the same ID with a new `running` state, which
 * chronological last-wins already expresses.
 */
export function sessionDelegations(messages: readonly NormalizedMessage[]): SessionDelegation[] {
  const delegationToolIds = new Set<string>();
  for (const message of messages) {
    if (message.kind === 'tool_use' && message.toolId && isDelegationToolName(message.toolName)) {
      delegationToolIds.add(message.toolId);
    }
  }
  const byId = new Map<string, SessionDelegation>();
  for (const message of messages) {
    if (message.kind === 'tool_use' && isDelegationToolName(message.toolName)) {
      const details = message.toolResult?.toolUseResult as { subagents?: unknown } | undefined;
      if (!details || typeof details !== 'object' || !Array.isArray(details.subagents)) continue;
      for (const entry of details.subagents) {
        const snapshot = snapshotFrom(entry, 'id');
        if (snapshot) byId.set(snapshot.delegationId, snapshot);
      }
      continue;
    }
    if (message.kind === 'tool_result' && message.toolId && delegationToolIds.has(message.toolId)) {
      const details = message.toolUseResult as { subagents?: unknown } | undefined;
      if (!details || typeof details !== 'object' || !Array.isArray(details.subagents)) continue;
      for (const entry of details.subagents) {
        const snapshot = snapshotFrom(entry, 'id');
        if (snapshot) byId.set(snapshot.delegationId, snapshot);
      }
      continue;
    }
    if (message.kind === 'delegation_updated') {
      const snapshot = snapshotFrom(message.delegation, 'delegationId');
      if (snapshot) byId.set(snapshot.delegationId, snapshot);
    }
  }
  return byId.size ? [...byId.values()] : EMPTY_DELEGATIONS;
}

/** Latest delegation state for the visible chat, re-read when its messages change. */
export function useSessionDelegations(sessionStore: SessionStore, sessionId: string | undefined, enabled: boolean): SessionDelegation[] {
  const { getMessages, subscribeSession } = sessionStore;
  const subscribe = useCallback(
    (listener: () => void) => (sessionId ? subscribeSession(sessionId, listener) : () => {}),
    [sessionId, subscribeSession],
  );
  const read = useCallback(() => (sessionId ? getMessages(sessionId) : EMPTY_MESSAGES), [getMessages, sessionId]);
  const messages = useSyncExternalStore(subscribe, read, read);
  return useMemo(() => (enabled && sessionId ? sessionDelegations(messages) : EMPTY_DELEGATIONS), [enabled, sessionId, messages]);
}
