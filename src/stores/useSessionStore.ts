/**
 * Session-keyed message store.
 *
 * Holds per-session state in a Map keyed by sessionId.
 * Session switch = change activeSessionId pointer. No clearing. Old data stays.
 * WebSocket handler = store.appendRealtime(msg.sessionId, msg). One line.
 * No localStorage for messages. Backend JSONL is the source of truth.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '../utils/api';
import type { LLMProvider } from '../types/app';
import type {
  JobProjectionErrorCode,
  JobProjectionEvent,
  JobSnapshot,
  JobState,
  JobTerminalPayload,
} from '../../shared/gjc-job-projection-protocol';

import { buildRefreshMessagesUrl } from './sessionMessageFetch';

// ─── NormalizedMessage (mirrors server/adapters/types.js) ────────────────────

export type MessageKind =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'stream_delta'
  | 'stream_end'
  | 'error'
  | 'complete'
  | 'status'
  | 'permission_request'
  | 'permission_cancelled'
  | 'session_created'
  | 'interactive_prompt'
  | 'task_notification';

export interface NormalizedMessage {
  id: string;
  sessionId: string;
  timestamp: string;
  provider: LLMProvider;
  kind: MessageKind;
  /**
   * Per-run monotonic sequence number assigned by the backend to live
   * websocket events. Used to compute `lastSeq` for `chat.subscribe` replay;
   * REST history messages do not carry it.
   */
  seq?: number;

  // kind-specific fields (flat for simplicity)
  role?: 'user' | 'assistant';
  content?: string;
  /**
   * Mirrors optional transcript metadata from the server.
   *
   * These fields are currently used by Claude history normalization so local
   * slash commands, local stdout, and compact summaries do not disappear when
   * the session store hydrates from REST history.
   */
  displayText?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  images?: Array<{ path?: string; data?: string; name?: string }>;
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  toolResult?: { content: string; isError: boolean; toolUseResult?: unknown } | null;
  isError?: boolean;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  tokenBudget?: unknown;
  requestId?: string;
  input?: unknown;
  context?: unknown;
  newSessionId?: string;
  status?: string;
  summary?: string;
  exitCode?: number;
  actualSessionId?: string;
  parentToolUseId?: string;
  subagentTools?: unknown[];
  isFinal?: boolean;
  // Cursor-specific ordering
  sequence?: number;
  rowid?: number;
}

// ─── Per-session slot ────────────────────────────────────────────────────────

export type SessionStatus = 'idle' | 'loading' | 'streaming' | 'error';

export interface SessionSlot {
  serverMessages: NormalizedMessage[];
  realtimeMessages: NormalizedMessage[];
  merged: NormalizedMessage[];
  /** @internal Cache-invalidation refs for computeMerged */
  _lastServerRef: NormalizedMessage[];
  _lastRealtimeRef: NormalizedMessage[];
  /**
   * @internal Monotonic ticket per server fetch (fetch/refresh/fetchMore).
   * Only the latest ticket may replace a session's loaded server window.
   */
  _fetchSeq: number;
  /** @internal Outstanding paginated request, if any. */
  _fetchMoreTicket: number | null;
  /** @internal Number of server requests still using this slot. */
  _pendingRequests: number;
  /** @internal Request currently allowed to settle `loading`. */
  _loadingTicket: number | null;
  status: SessionStatus;
  fetchedAt: number;
  total: number;
  hasMore: boolean;
  offset: number;
  tokenUsage: unknown;
}

const EMPTY: NormalizedMessage[] = [];
export type JobProjectionSlot = {
  snapshot: JobSnapshot | null;
  lastAppliedSequence: number;
  eventsBySequence: Map<number, JobProjectionEvent>;
  orderedTail: JobProjectionEvent[];
  status: 'idle' | 'subscribed' | 'error';
  error: JobProjectionErrorCode | 'protocol_violation' | null;
};

function createEmptyJobSlot(): JobProjectionSlot {
  return {
    snapshot: null,
    lastAppliedSequence: 0,
    eventsBySequence: new Map(),
    orderedTail: [],
    status: 'idle',
    error: null,
  };
}

function createEmptySlot(): SessionSlot {
  return {
    serverMessages: EMPTY,
    realtimeMessages: EMPTY,
    merged: EMPTY,
    _lastServerRef: EMPTY,
    _lastRealtimeRef: EMPTY,
    status: 'idle',
    fetchedAt: 0,
    total: 0,
    hasMore: false,
    offset: 0,
    tokenUsage: null,
    _fetchSeq: 0,
    _fetchMoreTicket: null,
    _pendingRequests: 0,
    _loadingTicket: null,
  };
}

function getRealtimeMessageIdentity(message: NormalizedMessage): string | null {
  if (message.id) {
    return `id:${message.id}`;
  }
  if (typeof message.sequence === 'number' && Number.isFinite(message.sequence)) {
    return `sequence:${message.sessionId}:${message.sequence}`;
  }
  return null;
}

function upsertRealtimeMessages(
  existing: NormalizedMessage[],
  incoming: NormalizedMessage[],
): NormalizedMessage[] {
  const updated = [...existing];
  const indexes = new Map<string, number>();

  updated.forEach((message, index) => {
    const identity = getRealtimeMessageIdentity(message);
    if (identity) indexes.set(identity, index);
  });

  for (const message of incoming) {
    const identity = getRealtimeMessageIdentity(message);
    const existingIndex = identity ? indexes.get(identity) : undefined;
    if (existingIndex !== undefined) {
      updated[existingIndex] = message;
      continue;
    }
    if (identity) indexes.set(identity, updated.length);
    updated.push(message);
  }

  return updated.length > MAX_REALTIME_MESSAGES
    ? updated.slice(-MAX_REALTIME_MESSAGES)
    : updated;
}

/**
 * Compute merged messages while preserving distinct persisted rows and
 * suppressing only exact IDs or proven synthetic realtime echoes.
 */
const LOCAL_USER_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const LOCAL_USER_DEDUPE_CLOCK_SKEW_MS = 10_000;

function userTextFingerprint(m: NormalizedMessage): string | null {
  if (m.kind !== 'text' || m.role !== 'user') return null;
  const t = (m.content || '').trim();
  return t.length > 0 ? t : null;
}

function readMessageTime(m: NormalizedMessage): number | null {
  const time = Date.parse(m.timestamp);
  return Number.isFinite(time) ? time : null;
}

function hasServerEchoForLocalUser(
  localMessage: NormalizedMessage,
  serverMessages: NormalizedMessage[],
): boolean {
  const localText = userTextFingerprint(localMessage);
  const localTime = readMessageTime(localMessage);
  if (!localText || localTime === null) {
    return false;
  }

  return serverMessages.some((serverMessage) => {
    if (userTextFingerprint(serverMessage) !== localText) {
      return false;
    }

    const serverTime = readMessageTime(serverMessage);
    return (
      serverTime !== null
      && serverTime >= localTime - LOCAL_USER_DEDUPE_CLOCK_SKEW_MS
      && serverTime - localTime <= LOCAL_USER_DEDUPE_WINDOW_MS
    );
  });
}

function compareMessagesChronologically(a: NormalizedMessage, b: NormalizedMessage): number {
  const timeA = readMessageTime(a) ?? 0;
  const timeB = readMessageTime(b) ?? 0;
  if (timeA !== timeB) {
    return timeA - timeB;
  }
  return 0;
}

/**
 * Count how many user turns precede `message` in a chronologically merged view
 * of server + realtime rows. Used to match a realtime row to the correct turn
 * on disk when several turns share identical assistant text.
 */
function getUserTurnOrdinalBefore(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): number {
  const messageTime = readMessageTime(message);
  let userCount = 0;

  const realtimeWithoutUserEchoes = realtimeMessages.filter((candidate) =>
    candidate.kind !== 'text'
    || candidate.role !== 'user'
    || !candidate.id.startsWith('local_')
    || !hasServerEchoForLocalUser(candidate, serverMessages),
  );

  for (const candidate of [...serverMessages, ...realtimeWithoutUserEchoes].sort(compareMessagesChronologically)) {
    if (candidate.id === message.id) {
      break;
    }

    const candidateTime = readMessageTime(candidate);
    if (
      messageTime !== null
      && candidateTime !== null
      && candidateTime > messageTime
    ) {
      break;
    }

    if (candidate.kind === 'text' && candidate.role === 'user') {
      userCount++;
    }
  }

  return Math.max(0, userCount - 1);
}

function findServerTurnRangeByOrdinal(
  serverMessages: NormalizedMessage[],
  turnOrdinal: number,
): { start: number; end: number } | null {
  let userCount = -1;
  let start = -1;

  for (let index = 0; index < serverMessages.length; index++) {
    const message = serverMessages[index];
    if (message.kind === 'text' && message.role === 'user') {
      userCount++;
      if (userCount === turnOrdinal) {
        start = index;
        break;
      }
    }
  }

  if (start < 0) {
    return null;
  }

  let end = serverMessages.length;
  for (let index = start + 1; index < serverMessages.length; index++) {
    if (serverMessages[index].kind === 'text' && serverMessages[index].role === 'user') {
      end = index;
      break;
    }
  }

  return { start, end };
}

function isAssistantTextEchoedInSameTurnOnServer(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): boolean {
  const assistantText = (message.content || '').trim();
  if (!assistantText) {
    return false;
  }

  const turnOrdinal = getUserTurnOrdinalBefore(message, serverMessages, realtimeMessages);
  const turnRange = findServerTurnRangeByOrdinal(serverMessages, turnOrdinal);
  if (!turnRange) {
    return false;
  }

  return serverMessages
    .slice(turnRange.start + 1, turnRange.end)
    .some((serverMessage) =>
      serverMessage.kind === 'text'
      && serverMessage.role === 'assistant'
      && (serverMessage.content || '').trim() === assistantText,
    );
}

/**
 * After `finalizeStreaming`, the client holds a synthetic assistant `text` row
 * while the sessions API soon returns the same reply with a different id.
 * The synthetic stream placeholder and its finalized realtime text may briefly
 * sit back-to-back. Collapse only that proven cross-source transition and exact
 * message IDs; preserve distinct persisted assistant rows even when text matches.
 */
function dedupeAdjacentAssistantEchoes(merged: NormalizedMessage[]): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  const seenIds = new Set<string>();
  for (const m of merged) {
    if (m.id && seenIds.has(m.id)) {
      continue;
    }
    const prev = out[out.length - 1];
    if (prev) {
      if (prev.kind === 'stream_delta' && m.kind === 'text' && m.role === 'assistant') {
        const ps = (prev.content || '').trim();
        const ms = (m.content || '').trim();
        if (ps.length > 0 && ps === ms) {
          out[out.length - 1] = m;
          if (m.id) seenIds.add(m.id);
          continue;
        }
      }
    }
    if (m.id) seenIds.add(m.id);
    out.push(m);
  }
  return out;
}

/**
 * After a server refresh, drop only the realtime rows the persisted transcript
 * already owns. Anything not yet on disk (common right after `complete`, while
 * JSONL indexing lags) stays in `realtimeMessages` so the chat pane never
 * flashes the empty "Continue your conversation" state.
 */
function pruneRealtimeSupersededByServer(
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): NormalizedMessage[] {
  if (realtimeMessages.length === 0) {
    return realtimeMessages;
  }

  const serverIds = new Set(serverMessages.map((message) => message.id).filter(Boolean));

  return realtimeMessages.filter((message) => {
    if (message.id && serverIds.has(message.id)) {
      return false;
    }

    if (message.id.startsWith('local_') && hasServerEchoForLocalUser(message, serverMessages)) {
      return false;
    }

    if (message.kind === 'stream_delta' || message.id === `__streaming_${message.sessionId}`) {
      if (isAssistantTextEchoedInSameTurnOnServer(message, serverMessages, realtimeMessages)) {
        return false;
      }
      return true;
    }

    if (
      message.kind === 'text'
      && message.role === 'assistant'
      && message.id.startsWith('text_')
    ) {
      if (isAssistantTextEchoedInSameTurnOnServer(message, serverMessages, realtimeMessages)) {
        return false;
      }
      return true;
    }

    if (message.kind === 'text' && message.role === 'user') {
      return !hasServerEchoForLocalUser(message, serverMessages);
    }

    if (message.kind === 'tool_use' && message.toolId) {
      if (serverMessages.some((serverMessage) => serverMessage.kind === 'tool_use' && serverMessage.toolId === message.toolId)) {
        return false;
      }
    }

    return true;
  });
}

function computeMerged(server: NormalizedMessage[], realtime: NormalizedMessage[]): NormalizedMessage[] {
  if (realtime.length === 0) {
    return server;
  }
  if (server.length === 0) {
    return dedupeAdjacentAssistantEchoes(realtime);
  }

  const serverIds = new Set(server.map((message) => message.id).filter(Boolean));
  const seenRealtimeIds = new Set<string>();
  const extra = realtime.filter((message) => {
    if (message.id && seenRealtimeIds.has(message.id)) {
      return false;
    }
    if (message.id) {
      seenRealtimeIds.add(message.id);
    }
    if (message.id && serverIds.has(message.id)) {
      return false;
    }
    // Optimistic user rows use `local_*` ids; once the same text exists on the
    // server-backed copy from the same send window, drop the realtime echo to
    // avoid duplicate bubbles without hiding repeated prompts from history.
    if (message.id.startsWith('local_')) {
      if (hasServerEchoForLocalUser(message, server)) {
        return false;
      }
    }
    if (
      message.kind === 'text'
      && message.role === 'assistant'
      && message.id.startsWith('text_')
      && isAssistantTextEchoedInSameTurnOnServer(message, server, realtime)
    ) {
      return false;
    }
    return true;
  });

  if (extra.length === 0) {
    return server;
  }

  // Interleave by timestamp so live rows stay with their turn instead of
  // piling up at the bottom after every refresh.
  return dedupeAdjacentAssistantEchoes(
    [...server, ...extra].sort(compareMessagesChronologically),
  );
}

/**
 * Recompute slot.merged only when the input arrays have actually changed
 * (by reference). Returns true if merged was recomputed.
 */
function recomputeMergedIfNeeded(slot: SessionSlot): boolean {
  if (slot.serverMessages === slot._lastServerRef && slot.realtimeMessages === slot._lastRealtimeRef) {
    return false;
  }
  slot._lastServerRef = slot.serverMessages;
  slot._lastRealtimeRef = slot.realtimeMessages;
  slot.merged = computeMerged(slot.serverMessages, slot.realtimeMessages);
  return true;
}

// ─── Stale threshold ─────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 30_000;

const MAX_REALTIME_MESSAGES = 500;
const MAX_SESSION_SLOTS = 50;

function dedupeMessagesById(messages: NormalizedMessage[]): NormalizedMessage[] {
  const ids = new Set<string>();
  return messages.filter((message) => {
    // An empty id is not a stable identity. Retain it rather than collapsing
    // potentially distinct legacy rows.
    if (!message.id || ids.has(message.id)) {
      return !message.id;
    }
    ids.add(message.id);
    return true;
  });
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSessionStore() {
  const storeRef = useRef(new Map<string, SessionSlot>());
  const activeSessionIdRef = useRef<string | null>(null);
  // Bump to force re-render — only when the active session's data changes.
  const jobSlotsRef = useRef(new Map<string, JobProjectionSlot>());
  const activeJobIdRef = useRef<string | null>(null);
  // Session ids are stable for the whole conversation lifetime (the backend
  // allocates them before the first send), so slots are keyed directly with
  // no alias/redirect indirection.
  const [, setTick] = useState(0);
  const notify = useCallback((sessionId: string) => {
    if (sessionId === activeSessionIdRef.current) {
      setTick(n => n + 1);
    }
  }, []);
  const notifyJob = useCallback((jobId: string) => {
    if (jobId === activeJobIdRef.current) setTick(n => n + 1);
  }, []);
  const trimInactiveSlots = useCallback((protectedSessionId?: string) => {
    const store = storeRef.current;
    while (store.size > MAX_SESSION_SLOTS) {
      const candidate = [...store.entries()].find(([sessionId, slot]) =>
        sessionId !== protectedSessionId
        && sessionId !== activeSessionIdRef.current
        && slot.status !== 'streaming'
        && slot._pendingRequests === 0,
      );
      if (!candidate) {
        return;
      }
      store.delete(candidate[0]);
    }
  }, []);

  const touchSlot = useCallback((sessionId: string, slot: SessionSlot) => {
    const store = storeRef.current;
    store.delete(sessionId);
    store.set(sessionId, slot);
    trimInactiveSlots(sessionId);
  }, [trimInactiveSlots]);

  const getJobSlot = useCallback((jobId: string): JobProjectionSlot => {
    const slot = jobSlotsRef.current.get(jobId) ?? createEmptyJobSlot();
    jobSlotsRef.current.set(jobId, slot);
    return slot;
  }, []);

  const setActiveJob = useCallback((jobId: string | null) => {
    activeJobIdRef.current = jobId;
    setTick(n => n + 1);
  }, []);

  const applyJobSubscribed = useCallback((jobId: string, snapshot: JobSnapshot) => {
    const slot = getJobSlot(jobId);
    slot.snapshot = snapshot;
    slot.status = 'subscribed';
    slot.error = null;
    notifyJob(jobId);
  }, [getJobSlot, notifyJob]);

  const applyJobEvent = useCallback((jobId: string, event: JobProjectionEvent) => {
    const slot = getJobSlot(jobId);
    const existing = slot.eventsBySequence.get(event.sequence);
    if (event.sequence <= slot.lastAppliedSequence) {
      if (existing?.eventId === event.eventId) return true;
      if (existing && existing.eventId !== event.eventId) {
        slot.status = 'error';
        slot.error = 'protocol_violation';
        notifyJob(jobId);
        return false;
      }
      return true;
    }
    if (event.sequence !== slot.lastAppliedSequence + 1 || existing) {
      slot.status = 'error';
      slot.error = 'protocol_violation';
      notifyJob(jobId);
      return false;
    }
    const payload = event.payload as Partial<JobTerminalPayload> | null;
    const isTerminal = payload !== null
      && typeof payload === 'object'
      && payload.schemaVersion === 1
      && payload.kind === 'job_terminal'
      && (payload.jobState === 'succeeded' || payload.jobState === 'failed' || payload.jobState === 'aborted' || payload.jobState === 'interrupted');
    if (isTerminal && slot.snapshot) {
      slot.snapshot = {
        ...slot.snapshot,
        state: payload.jobState as JobState,
      };
    }
    slot.eventsBySequence.set(event.sequence, event);
    slot.orderedTail = [...slot.orderedTail, event];
    slot.lastAppliedSequence = event.sequence;
    slot.status = 'subscribed';
    slot.error = null;
    notifyJob(jobId);
    return true;
  }, [getJobSlot, notifyJob]);

  const applyJobReplayChunk = useCallback((jobId: string, events: JobProjectionEvent[]) => {
    for (const event of events) {
      if (!applyJobEvent(jobId, event)) return false;
    }
    return true;
  }, [applyJobEvent]);

  const applyJobLiveEvent = useCallback((jobId: string, event: JobProjectionEvent) =>
    applyJobEvent(jobId, event), [applyJobEvent]);

  const getJobCursor = useCallback((jobId: string) =>
    jobSlotsRef.current.get(jobId)?.lastAppliedSequence ?? 0, []);

  const setJobError = useCallback((jobId: string, error: JobProjectionErrorCode | 'protocol_violation') => {
    const slot = getJobSlot(jobId);
    slot.status = 'error';
    slot.error = error;
    notifyJob(jobId);
  }, [getJobSlot, notifyJob]);

  const clearJobs = useCallback(() => {
    const wasActive = activeJobIdRef.current !== null;
    jobSlotsRef.current.clear();
    activeJobIdRef.current = null;
    if (wasActive) setTick(n => n + 1);
  }, []);

  const setActiveSession = useCallback((sessionId: string | null) => {
    activeSessionIdRef.current = sessionId;
    if (sessionId) {
      const slot = storeRef.current.get(sessionId);
      if (slot) {
        touchSlot(sessionId, slot);
      }
    }
    trimInactiveSlots();
  }, [touchSlot, trimInactiveSlots]);

  const getSlot = useCallback((sessionId: string): SessionSlot => {
    const store = storeRef.current;
    const slot = store.get(sessionId) ?? createEmptySlot();
    touchSlot(sessionId, slot);
    return slot;
  }, [touchSlot]);

  const beginRequest = useCallback((sessionId: string): SessionSlot => {
    const store = storeRef.current;
    const slot = store.get(sessionId) ?? createEmptySlot();
    slot._pendingRequests += 1;
    touchSlot(sessionId, slot);
    return slot;
  }, [touchSlot]);

  const has = useCallback((sessionId: string) => {
    return storeRef.current.has(sessionId);
  }, []);

  /**
   * Fetch messages from the provider sessions endpoint and populate serverMessages.
   *
   * Provider and project metadata are resolved server-side from `sessionId`.
   * The endpoint returns the standard `{ success, data }` envelope.
   */
  const fetchFromServer = useCallback(async (
    sessionId: string,
    opts: {
      limit?: number | null;
      offset?: number;
    } = {},
  ) => {
    const slot = beginRequest(sessionId);
    const fetchTicket = ++slot._fetchSeq;
    if (slot.status !== 'streaming') {
      slot._loadingTicket = fetchTicket;
      slot.status = 'loading';
    }
    notify(sessionId);

    try {
      const params = new URLSearchParams();
      if (opts.limit !== null && opts.limit !== undefined) {
        params.append('limit', String(opts.limit));
        params.append('offset', String(opts.offset ?? 0));
      }

      const qs = params.toString();
      const url = `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`;
      const response = await authenticatedFetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const body = await response.json();
      const data = body?.data ?? body;
      const messages: NormalizedMessage[] = data.messages || [];

      // Only the latest request may replace this session's loaded window.
      if (fetchTicket !== slot._fetchSeq) {
        return slot;
      }

      slot.serverMessages = dedupeMessagesById(messages);
      slot.total = data.total ?? messages.length;
      slot.hasMore = Boolean(data.hasMore);
      slot.offset = (opts.offset ?? 0) + messages.length;
      slot.fetchedAt = Date.now();
      if (slot.status === 'loading' && slot._loadingTicket === fetchTicket) {
        slot.status = 'idle';
      }
      recomputeMergedIfNeeded(slot);
      if (data.tokenUsage) {
        slot.tokenUsage = data.tokenUsage;
      }

      notify(sessionId);
      return slot;
    } catch (error) {
      console.error(`[SessionStore] fetch failed for ${sessionId}:`, error);
      // Don't clobber a newer fetch's result with a stale failure.
      if (
        fetchTicket === slot._fetchSeq
        && slot.status === 'loading'
        && slot._loadingTicket === fetchTicket
      ) {
        slot.status = 'error';
        notify(sessionId);
      }
      return slot;
    } finally {
      slot._pendingRequests -= 1;
      if (slot._loadingTicket === fetchTicket) {
        slot._loadingTicket = null;
      }
      trimInactiveSlots();
    }
  }, [beginRequest, notify, trimInactiveSlots]);

  /**
   * Load older (paginated) messages and prepend to serverMessages.
   */
  const fetchMore = useCallback(async (
    sessionId: string,
    opts: {
      limit?: number;
    } = {},
  ) => {
    const store = storeRef.current;
    const slot = store.get(sessionId) ?? createEmptySlot();
    if (!slot.hasMore || slot._fetchMoreTicket !== null) {
      touchSlot(sessionId, slot);
      return slot;
    }

    const expectedOffset = slot.offset;
    const fetchTicket = ++slot._fetchSeq;
    slot._fetchMoreTicket = fetchTicket;
    slot._pendingRequests += 1;
    touchSlot(sessionId, slot);
    if (slot.status === 'loading') {
      slot._loadingTicket = fetchTicket;
    }
    const params = new URLSearchParams();
    const limit = opts.limit ?? 20;
    params.append('limit', String(limit));
    params.append('offset', String(expectedOffset));

    const qs = params.toString();
    const url = `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`;

    try {
      const response = await authenticatedFetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const data = body?.data ?? body;
      const olderMessages: NormalizedMessage[] = data.messages || [];

      // A different request or loaded-window replacement invalidated this
      // cursor. Never prepend a page fetched for another offset.
      if (
        fetchTicket !== slot._fetchSeq
        || slot._fetchMoreTicket !== fetchTicket
        || slot.offset !== expectedOffset
      ) {
        return slot;
      }

      slot.serverMessages = dedupeMessagesById([
        ...olderMessages,
        ...slot.serverMessages,
      ]);
      slot.hasMore = Boolean(data.hasMore);
      slot.offset = expectedOffset + olderMessages.length;
      if (slot.status === 'loading' && slot._loadingTicket === fetchTicket) {
        slot.status = 'idle';
      }
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
      return slot;
    } catch (error) {
      console.error(`[SessionStore] fetchMore failed for ${sessionId}:`, error);
      if (
        fetchTicket === slot._fetchSeq
        && slot.status === 'loading'
        && slot._loadingTicket === fetchTicket
      ) {
        slot.status = 'idle';
        notify(sessionId);
      }
      return slot;
    } finally {
      slot._pendingRequests -= 1;
      if (slot._fetchMoreTicket === fetchTicket) {
        slot._fetchMoreTicket = null;
      }
      if (slot._loadingTicket === fetchTicket) {
        slot._loadingTicket = null;
      }
      trimInactiveSlots();
    }
  }, [notify, touchSlot, trimInactiveSlots]);

  /**
   * Append a realtime (WebSocket) message to the correct session slot.
   * This works regardless of which session is actively viewed.
   */
  const appendRealtime = useCallback((sessionId: string, msg: NormalizedMessage) => {
    const slot = getSlot(sessionId);
    const normalizedMessage =
      msg.sessionId === sessionId
        ? msg
        : { ...msg, sessionId };
    slot.realtimeMessages = upsertRealtimeMessages(
      slot.realtimeMessages,
      [normalizedMessage],
    );
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Append multiple realtime messages at once (batch).
   */
  const appendRealtimeBatch = useCallback((sessionId: string, msgs: NormalizedMessage[]) => {
    if (msgs.length === 0) return;
    const slot = getSlot(sessionId);
    const normalizedMessages = msgs.map((msg) =>
      msg.sessionId === sessionId
        ? msg
        : { ...msg, sessionId },
    );
    slot.realtimeMessages = upsertRealtimeMessages(
      slot.realtimeMessages,
      normalizedMessages,
    );
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Re-fetch serverMessages from the provider sessions endpoint.
   */
  const refreshFromServer = useCallback(async (
    sessionId: string,
  ) => {
    const slot = beginRequest(sessionId);
    const fetchTicket = ++slot._fetchSeq;
    if (slot.status === 'loading') {
      slot._loadingTicket = fetchTicket;
    }
    try {
      // Bound the reconcile fetch to the currently-loaded window so a large
      // transcript is not re-pulled in full on every refresh (latest-N + scroll-up
      // lazy-load stays intact). total/hasMore below keep older messages reachable.
      const loadedCount = slot.serverMessages.length + slot.realtimeMessages.length;
      const url = buildRefreshMessagesUrl(sessionId, loadedCount);
      const response = await authenticatedFetch(url);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const data = body?.data ?? body;

      // Only the latest request may replace this session's loaded window.
      if (fetchTicket !== slot._fetchSeq) {
        return;
      }

      const messages: NormalizedMessage[] = data.messages || [];
      slot.serverMessages = dedupeMessagesById(messages);
      slot.total = data.total ?? messages.length;
      slot.hasMore = Boolean(data.hasMore);
      slot.offset = messages.length;
      slot.fetchedAt = Date.now();
      if (slot.status === 'loading' && slot._loadingTicket === fetchTicket) {
        slot.status = 'idle';
      }
      // Only drop realtime rows the server transcript now owns. A blind clear
      // here caused the chat pane to flash "Continue your conversation" after
      // `complete` while JSONL / provider_session_id indexing was still behind.
      slot.realtimeMessages = pruneRealtimeSupersededByServer(
        slot.serverMessages,
        slot.realtimeMessages,
      );
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
    } catch (error) {
      console.error(`[SessionStore] refresh failed for ${sessionId}:`, error);
      if (
        fetchTicket === slot._fetchSeq
        && slot.status === 'loading'
        && slot._loadingTicket === fetchTicket
      ) {
        slot.status = 'idle';
        notify(sessionId);
      }
    } finally {
      slot._pendingRequests -= 1;
      if (slot._loadingTicket === fetchTicket) {
        slot._loadingTicket = null;
      }
      trimInactiveSlots();
    }
  }, [beginRequest, notify, trimInactiveSlots]);

  /**
   * Update session status.
   */
  const setStatus = useCallback((sessionId: string, status: SessionStatus) => {
    const slot = getSlot(sessionId);
    slot._loadingTicket = null;
    slot.status = status;
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Check if a session's data is stale (>30s old).
   */
  const isStale = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (!slot) return true;
    return Date.now() - slot.fetchedAt > STALE_THRESHOLD_MS;
  }, []);

  /**
   * Update or create a streaming message (accumulated text so far).
   * Uses a well-known ID so subsequent calls replace the same message.
   */
  const updateStreaming = useCallback((sessionId: string, accumulatedText: string, msgProvider: LLMProvider) => {
    const slot = getSlot(sessionId);
    const streamId = `__streaming_${sessionId}`;
    const msg: NormalizedMessage = {
      id: streamId,
      sessionId,
      timestamp: new Date().toISOString(),
      provider: msgProvider,
      kind: 'stream_delta',
      content: accumulatedText,
    };
    const idx = slot.realtimeMessages.findIndex(m => m.id === streamId);
    if (idx >= 0) {
      slot.realtimeMessages = [...slot.realtimeMessages];
      slot.realtimeMessages[idx] = msg;
    } else {
      slot.realtimeMessages = [...slot.realtimeMessages, msg];
    }
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Finalize streaming: convert the streaming message to a regular text message.
   * The well-known streaming ID is replaced with a unique text message ID.
   */
  const finalizeStreaming = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (!slot) return;
    const streamId = `__streaming_${sessionId}`;
    const idx = slot.realtimeMessages.findIndex(m => m.id === streamId);
    if (idx >= 0) {
      const stream = slot.realtimeMessages[idx];
      slot.realtimeMessages = [...slot.realtimeMessages];
      slot.realtimeMessages[idx] = {
        ...stream,
        id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: 'text',
        role: 'assistant',
      };
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
    }
  }, [notify]);

  /**
   * Clear realtime messages for a session (e.g., after stream completes and server fetch catches up).
   */
  const clearRealtime = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (slot) {
      slot.realtimeMessages = [];
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
    }
  }, [notify]);
  /**
   * Drop every cached transcript at an authentication boundary. Existing
   * in-flight requests retain only their detached slots and cannot repopulate
   * this store.
   */
  const clear = useCallback(() => {
    const hadActiveSession = activeSessionIdRef.current !== null;
    storeRef.current.clear();
    activeSessionIdRef.current = null;
    if (hadActiveSession) {
      setTick(n => n + 1);
    }
  }, []);


  /**
   * Get merged messages for a session (for rendering).
   *
   * Callers read this on every render (the store signals changes via a tick
   * re-render, not a new store identity), so the empty result must be
   * identity-stable to keep downstream memos from recomputing on no-ops.
   */
  const getMessages = useCallback((sessionId: string): NormalizedMessage[] => {
    return storeRef.current.get(sessionId)?.merged ?? EMPTY;
  }, []);

  /**
   * Get session slot (for status, pagination info, etc.).
   */
  const getSessionSlot = useCallback((sessionId: string): SessionSlot | undefined => {
    return storeRef.current.get(sessionId);
  }, []);

  return useMemo(() => ({
    getSlot,
    has,
    fetchFromServer,
    fetchMore,
    appendRealtime,
    appendRealtimeBatch,
    refreshFromServer,
    setActiveSession,
    setStatus,
    isStale,
    updateStreaming,
    finalizeStreaming,
    clearRealtime,
    clear,
    getJobSlot,
    getJobCursor,
    setActiveJob,
    applyJobSubscribed,
    applyJobReplayChunk,
    applyJobLiveEvent,
    setJobError,
    clearJobs,
    getMessages,
    getSessionSlot,
  }), [
    getSlot, has, fetchFromServer, fetchMore,
    appendRealtime, appendRealtimeBatch, refreshFromServer,
    setActiveSession, setStatus, isStale, updateStreaming, finalizeStreaming,
    clearRealtime, clear, getMessages, getSessionSlot,
    getJobSlot, getJobCursor, setActiveJob, applyJobSubscribed, applyJobReplayChunk,
    applyJobLiveEvent, setJobError, clearJobs,
  ]);
}

export type SessionStore = ReturnType<typeof useSessionStore>;
