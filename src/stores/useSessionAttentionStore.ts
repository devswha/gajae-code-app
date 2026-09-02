import { create } from 'zustand';

import { safeLocalStorage } from '../components/chat/utils/chatStorage';

import type { SessionOutcome } from './sessionStatusModel';

/**
 * What the sidebar needs to know about sessions the user is *not* looking at:
 * which ones finished or failed since they last looked, and which ones are
 * waiting on an answer.
 *
 * Outcomes and last-viewed times persist to localStorage so a reload does not
 * turn every finished session back into a plain row. Pending questions do not
 * persist: the server re-reports them on the next running-sessions poll, and a
 * stored question with no run behind it would be a lie.
 */

export const SESSION_ATTENTION_STORAGE_KEY = 'session-attention-v1';

/** Entries kept per persisted record; oldest fall off first. */
const PERSISTED_ENTRY_LIMIT = 300;

/**
 * A locally recorded question survives at least this long against a poll
 * that does not mention it. The poll runs every 5s and may have been in
 * flight when the question arrived; anything older than this and still
 * absent from the server's view was answered somewhere we did not see.
 */
export const PENDING_INPUT_STALE_MS = 7_000;

export type PendingInput = { requestIds: readonly string[]; since: number };

type PersistedAttention = {
  outcomes: Record<string, SessionOutcome>;
  lastViewedAt: Record<string, number>;
};

export type SessionAttentionState = PersistedAttention & {
  pendingInput: Record<string, PendingInput>;
  /** Replaces the remembered outcome; `null` forgets it (a new run began, or the user stopped it). */
  recordOutcome: (sessionId: string, outcome: SessionOutcome | null) => void;
  /** The user has this session in front of them now: nothing about it is unread any more. */
  markSessionViewed: (sessionId: string, at?: number) => void;
  addPendingInput: (sessionId: string, requestId: string) => void;
  /** Request ids are unique across sessions, so answering one needs no session. */
  removePendingInput: (requestId: string) => void;
  setPendingInput: (sessionId: string, requestIds: readonly string[]) => void;
  clearPendingInput: (sessionId: string) => void;
  /**
   * Folds the server's view in. The server is the authority on open approvals,
   * but a poll can be older than a question we just received, so a local entry
   * is only dropped once it has outlived {@link PENDING_INPUT_STALE_MS}.
   */
  reconcilePendingInput: (sessionId: string, serverAwaitingInput: boolean, now?: number) => void;
  forgetSession: (sessionId: string) => void;
};

const isOutcome = (value: unknown): value is SessionOutcome => {
  if (!value || typeof value !== 'object') return false;
  const { kind, at } = value as Record<string, unknown>;
  return (kind === 'ready' || kind === 'blocked') && typeof at === 'number' && Number.isFinite(at);
};

function readPersisted(): PersistedAttention {
  const empty: PersistedAttention = { outcomes: {}, lastViewedAt: {} };
  const raw = safeLocalStorage.getItem(SESSION_ATTENTION_STORAGE_KEY);
  if (!raw) return empty;
  try {
    const decoded = JSON.parse(raw) as Partial<Record<keyof PersistedAttention, unknown>>;
    const outcomes: Record<string, SessionOutcome> = {};
    if (decoded.outcomes && typeof decoded.outcomes === 'object') {
      for (const [sessionId, outcome] of Object.entries(decoded.outcomes as Record<string, unknown>)) {
        if (isOutcome(outcome)) outcomes[sessionId] = outcome;
      }
    }
    const lastViewedAt: Record<string, number> = {};
    if (decoded.lastViewedAt && typeof decoded.lastViewedAt === 'object') {
      for (const [sessionId, at] of Object.entries(decoded.lastViewedAt as Record<string, unknown>)) {
        if (typeof at === 'number' && Number.isFinite(at)) lastViewedAt[sessionId] = at;
      }
    }
    return { outcomes, lastViewedAt };
  } catch {
    return empty;
  }
}

function newest<T>(record: Record<string, T>, timeOf: (value: T) => number): Record<string, T> {
  const entries = Object.entries(record);
  if (entries.length <= PERSISTED_ENTRY_LIMIT) return record;
  entries.sort(([, left], [, right]) => timeOf(right) - timeOf(left));
  return Object.fromEntries(entries.slice(0, PERSISTED_ENTRY_LIMIT));
}

function persist(state: PersistedAttention): PersistedAttention {
  const bounded: PersistedAttention = {
    outcomes: newest(state.outcomes, (outcome) => outcome.at),
    lastViewedAt: newest(state.lastViewedAt, (at) => at),
  };
  safeLocalStorage.setItem(SESSION_ATTENTION_STORAGE_KEY, JSON.stringify(bounded));
  return bounded;
}

const without = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record;
  const { [key]: _dropped, ...rest } = record;
  return rest;
};

export const useSessionAttentionStore = create<SessionAttentionState>()((set) => ({
  ...readPersisted(),
  pendingInput: {},

  recordOutcome: (sessionId, outcome) => set((state) => {
    const current = state.outcomes[sessionId];
    if (!outcome && !current) return state;
    if (outcome && current && current.kind === outcome.kind && current.at === outcome.at) return state;
    const outcomes = outcome ? { ...state.outcomes, [sessionId]: outcome } : without(state.outcomes, sessionId);
    return persist({ outcomes, lastViewedAt: state.lastViewedAt });
  }),

  markSessionViewed: (sessionId, at = Date.now()) => set((state) => {
    const previous = state.lastViewedAt[sessionId];
    if (previous !== undefined && previous >= at && !(sessionId in state.outcomes)) return state;
    return persist({
      outcomes: without(state.outcomes, sessionId),
      lastViewedAt: { ...state.lastViewedAt, [sessionId]: Math.max(at, previous ?? 0) },
    });
  }),

  addPendingInput: (sessionId, requestId) => set((state) => {
    const current = state.pendingInput[sessionId];
    if (current?.requestIds.includes(requestId)) return state;
    const entry: PendingInput = current
      ? { requestIds: [...current.requestIds, requestId], since: current.since }
      : { requestIds: [requestId], since: Date.now() };
    return { pendingInput: { ...state.pendingInput, [sessionId]: entry } };
  }),

  removePendingInput: (requestId) => set((state) => {
    let changed = false;
    const pendingInput: Record<string, PendingInput> = {};
    for (const [sessionId, entry] of Object.entries(state.pendingInput)) {
      if (!entry.requestIds.includes(requestId)) {
        pendingInput[sessionId] = entry;
        continue;
      }
      changed = true;
      const requestIds = entry.requestIds.filter((id) => id !== requestId);
      if (requestIds.length) pendingInput[sessionId] = { requestIds, since: entry.since };
    }
    return changed ? { pendingInput } : state;
  }),

  setPendingInput: (sessionId, requestIds) => set((state) => {
    const current = state.pendingInput[sessionId];
    if (!requestIds.length) return current ? { pendingInput: without(state.pendingInput, sessionId) } : state;
    if (current && current.requestIds.length === requestIds.length && requestIds.every((id) => current.requestIds.includes(id))) return state;
    return { pendingInput: { ...state.pendingInput, [sessionId]: { requestIds: [...requestIds], since: current?.since ?? Date.now() } } };
  }),

  clearPendingInput: (sessionId) => set((state) => (
    sessionId in state.pendingInput ? { pendingInput: without(state.pendingInput, sessionId) } : state
  )),

  reconcilePendingInput: (sessionId, serverAwaitingInput, now = Date.now()) => set((state) => {
    const current = state.pendingInput[sessionId];
    if (serverAwaitingInput) {
      if (current) return state;
      // The server knows of a question this browser never saw (it arrived
      // before a reload, or on another client). Record it under a marker id
      // so the row asks for input until the server stops reporting it.
      return { pendingInput: { ...state.pendingInput, [sessionId]: { requestIds: [`server:${sessionId}`], since: now } } };
    }
    if (!current) return state;
    const serverOnly = current.requestIds.every((id) => id.startsWith('server:'));
    if (!serverOnly && now - current.since < PENDING_INPUT_STALE_MS) return state;
    return { pendingInput: without(state.pendingInput, sessionId) };
  }),

  forgetSession: (sessionId) => set((state) => {
    const known = sessionId in state.outcomes || sessionId in state.lastViewedAt || sessionId in state.pendingInput;
    if (!known) return state;
    return {
      ...persist({ outcomes: without(state.outcomes, sessionId), lastViewedAt: without(state.lastViewedAt, sessionId) }),
      pendingInput: without(state.pendingInput, sessionId),
    };
  }),
}));

export const resetSessionAttentionStore = () => {
  useSessionAttentionStore.setState({ ...readPersisted(), pendingInput: {} });
};
