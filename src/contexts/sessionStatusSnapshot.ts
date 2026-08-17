/**
 * The facts the Workspace Status tab renders about the session the user is
 * looking at.
 *
 * The chat owns this data — it arrives on the session's own websocket events —
 * but the Status tab lives outside the chat tree, so the snapshot is published
 * through a context. Everything here stays a pure value so the publish path can
 * compare two snapshots without re-rendering the panel on every keystroke.
 */

export type SessionTokenTotals = {
  used: number;
  input?: number;
  output?: number;
  cache?: number;
};

export type SessionActivity = {
  running: boolean;
  /** Provider phase such as "Compacting" — null when it is just running. */
  statusText: string | null;
  /** Follow-up messages waiting for the current turn to finish. */
  queued: number;
};

export type SessionStatusSnapshot = {
  sessionId: string | null;
  modelId?: string;
  thinkingLevel?: string;
  cwd?: string;
  contextTokens?: number;
  contextWindow?: number;
  /** 0-100, as the runtime reported it. Never derived from a guessed window. */
  contextPercent?: number;
  contextSource?: string;
  tokens?: SessionTokenTotals;
  activity: SessionActivity;
};

export const EMPTY_SESSION_STATUS: SessionStatusSnapshot = {
  sessionId: null,
  activity: { running: false, statusText: null, queued: 0 },
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const nonNegative = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

const positive = (value: unknown): number | undefined => {
  const parsed = nonNegative(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};

/**
 * Maps the loose `session_state` record the chat keeps onto the typed snapshot.
 *
 * The record is whatever the runtime sent, so every field is validated rather
 * than cast: a missing value must read as unknown in the panel, never as zero.
 */
export function readSessionFacts(sessionState: Record<string, unknown> | null | undefined): Partial<SessionStatusSnapshot> {
  if (!sessionState) {
    return {};
  }

  const percent = nonNegative(sessionState.contextPercent);

  return {
    modelId: text(sessionState.modelId),
    thinkingLevel: text(sessionState.thinkingLevel),
    cwd: text(sessionState.cwd),
    contextTokens: nonNegative(sessionState.contextTokens),
    contextWindow: positive(sessionState.contextWindow),
    contextPercent: percent === undefined ? undefined : Math.min(100, percent),
    contextSource: text(sessionState.contextSource),
  };
}

/**
 * Maps the token-budget record onto totals, or undefined when the runtime has
 * not reported any usage. Zero-token sessions report nothing rather than a row
 * of zeroes.
 */
export function readTokenTotals(tokenBudget: Record<string, unknown> | null | undefined): SessionTokenTotals | undefined {
  if (!tokenBudget) {
    return undefined;
  }

  const breakdown = typeof tokenBudget.breakdown === 'object' && tokenBudget.breakdown !== null
    ? tokenBudget.breakdown as Record<string, unknown>
    : null;

  const input = nonNegative(tokenBudget.inputTokens) ?? nonNegative(breakdown?.input);
  const output = nonNegative(tokenBudget.outputTokens) ?? nonNegative(breakdown?.output);
  const cache = nonNegative(tokenBudget.cacheTokens)
    ?? (nonNegative(tokenBudget.cacheReadTokens) ?? 0) + (nonNegative(tokenBudget.cacheCreationTokens) ?? 0);
  const used = nonNegative(tokenBudget.used) ?? (input ?? 0) + (output ?? 0);

  if (used <= 0) {
    return undefined;
  }

  return {
    used,
    input,
    output,
    cache: cache > 0 ? cache : undefined,
  };
}

function sameTokens(left: SessionTokenTotals | undefined, right: SessionTokenTotals | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.used === right.used
    && left.input === right.input
    && left.output === right.output
    && left.cache === right.cache;
}

/**
 * True when two snapshots would render identically. The publisher runs on every
 * chat render, so this is what keeps the panel from re-rendering with it.
 */
export function sameSessionStatus(left: SessionStatusSnapshot, right: SessionStatusSnapshot): boolean {
  return left.sessionId === right.sessionId
    && left.modelId === right.modelId
    && left.thinkingLevel === right.thinkingLevel
    && left.cwd === right.cwd
    && left.contextTokens === right.contextTokens
    && left.contextWindow === right.contextWindow
    && left.contextPercent === right.contextPercent
    && left.contextSource === right.contextSource
    && left.activity.running === right.activity.running
    && left.activity.statusText === right.activity.statusText
    && left.activity.queued === right.activity.queued
    && sameTokens(left.tokens, right.tokens);
}

/** Compact token rendering shared by the status rows: 12_300 -> "12.3K". */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}
