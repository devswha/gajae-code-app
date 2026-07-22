// Reconcile fetch sizing for the session message store.
//
// refreshFromServer() re-fetches the server transcript after streaming, a WS
// reconnect, or a realtime event to reconcile optimistic/realtime rows. It used
// to request the endpoint with NO limit, so the backend returned the ENTIRE
// transcript (route defaults limit=null) — a 766-message session was pulled in
// full on every refresh, which is what made opening large sessions heavy.
//
// The backend already paginates identically for every provider (readline stream
// + tail page + total/hasMore), so the fix is to make the reconcile fetch honor
// that contract: request only the currently-loaded window (never fewer than
// REFRESH_RECONCILE_MIN_MESSAGES). Older messages stay reachable via scroll-up
// (fetchMore) because total/hasMore are unchanged.

export const REFRESH_RECONCILE_MIN_MESSAGES = 20;

/**
 * Builds the bounded reconcile URL for refreshFromServer.
 *
 * @param sessionId   provider session id
 * @param loadedCount how many messages are currently loaded/shown for the session
 *                    (server rows + realtime rows); the reconcile fetch is sized to
 *                    this so it never shrinks the visible window nor pulls the whole
 *                    transcript.
 */
export function buildRefreshMessagesUrl(sessionId: string, loadedCount: number): string {
  const safeLoaded = Number.isFinite(loadedCount) ? Math.max(0, Math.floor(loadedCount)) : 0;
  const reconcileLimit = Math.max(safeLoaded, REFRESH_RECONCILE_MIN_MESSAGES);
  const params = new URLSearchParams({ limit: String(reconcileLimit), offset: '0' });
  return `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages?${params.toString()}`;
}
