/**
 * The session facts the composer footer needs, read off the live SDK session.
 *
 * The app already receives a token count, but never the context window it is a
 * fraction of, so it can only render "12.3K" where the TUI footer renders
 * "42%/200k". The window is genuinely absent from a message's `usage` — but it
 * is one call away on the session, and so are the reasoning level and the
 * working directory. Nothing here is new capability; the app simply never
 * asked.
 *
 * Every read is defensive. This runs inside the turn's event path, and a
 * snapshot that throws would take a real answer down with it.
 */

export type GjcSessionSnapshot = {
  modelId?: string;
  /** Reasoning effort, as the session reports it (`off`, `low`, `high`, ...). */
  thinkingLevel?: string;
  /** Absolute working directory this session is bound to. */
  cwd?: string;
  contextTokens?: number;
  contextWindow?: number;
  /** 0-100. Absent when the window is unknown, never faked from a default. */
  contextPercent?: number;
  /** How the token figure was obtained, e.g. `exact` or `estimate`. */
  contextSource?: string;
};

type SessionLike = {
  model?: { id?: unknown } | null;
  thinkingLevel?: unknown;
  getContextUsage?: () => unknown;
};

type SessionManagerLike = {
  getCwd?: () => unknown;
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const nonNegative = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * Reads a snapshot, or returns undefined when there is nothing worth sending.
 *
 * An empty snapshot is deliberately not sent: the footer should keep showing
 * its last known values rather than blanking whenever one read comes back
 * unavailable.
 */
export function readSessionSnapshot(
  session: unknown,
  sessionManager: unknown,
): GjcSessionSnapshot | undefined {
  const snapshot: GjcSessionSnapshot = {};

  try {
    const live = session as SessionLike | null;
    const modelId = text(live?.model?.id);
    if (modelId) snapshot.modelId = modelId;

    const thinkingLevel = text(live?.thinkingLevel);
    if (thinkingLevel) snapshot.thinkingLevel = thinkingLevel;

    const usage = live?.getContextUsage?.();
    if (usage && typeof usage === 'object') {
      const record = usage as Record<string, unknown>;
      const contextWindow = positive(record.contextWindow);
      const contextTokens = nonNegative(record.tokens);
      const contextSource = text(record.source);
      if (contextWindow !== undefined) snapshot.contextWindow = contextWindow;
      if (contextTokens !== undefined) snapshot.contextTokens = contextTokens;
      if (contextSource) snapshot.contextSource = contextSource;

      // The session reports its own percentage; recompute only when it is
      // absent, and never invent one without a real window.
      const reported = nonNegative(record.percent);
      if (reported !== undefined) snapshot.contextPercent = reported;
      else if (contextWindow !== undefined && contextTokens !== undefined) {
        snapshot.contextPercent = (contextTokens / contextWindow) * 100;
      }
    }
  } catch {
    // A partial snapshot is still useful; an exception here is not.
  }

  try {
    const cwd = text((sessionManager as SessionManagerLike | null)?.getCwd?.());
    if (cwd) snapshot.cwd = cwd;
  } catch {
    // Same: the working directory is the least important field here.
  }

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}
