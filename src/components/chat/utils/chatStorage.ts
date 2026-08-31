export const DRAFT_KEY_PREFIX = 'draft_input_';
export const QUEUE_KEY_PREFIX = 'queued_message_';

/** Removes every key under a prefix except the one being written. */
function dropKeysWithPrefix(prefix: string, except: string): number {
  const doomed = Object.keys(localStorage).filter((key) => key.startsWith(prefix) && key !== except);
  doomed.forEach((key) => localStorage.removeItem(key));
  return doomed.length;
}

export const safeLocalStorage = {
  /**
   * Writes, and makes room in a defined order if the store is full.
   *
   * The two things stored here are not worth the same. A draft is unsent text
   * the user can see and retype; a queued message is one they have already sent
   * and are waiting on, which the reader below goes to some length to recover
   * from three historical shapes rather than drop. Taking drafts first, and
   * queued messages only if that was not enough, is the difference between
   * losing a keystroke and losing a request.
   */
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
      return;
    } catch (error: any) {
      if (error?.name !== 'QuotaExceededError') {
        console.error('localStorage error:', error);
        return;
      }
    }

    if (dropKeysWithPrefix(DRAFT_KEY_PREFIX, key) > 0) {
      try {
        localStorage.setItem(key, value);
        return;
      } catch {
        // Still full: the drafts were not what was holding the space.
      }
    }

    const discarded = dropKeysWithPrefix(QUEUE_KEY_PREFIX, key);
    if (discarded > 0) {
      // Never silent. This is the case where the user loses something they were
      // waiting on, and the console is the only channel this module has.
      console.warn(
        `localStorage was full: discarded ${discarded} queued message(s) that had not been sent yet.`,
      );
    }

    try {
      localStorage.setItem(key, value);
    } catch (retryError) {
      console.error('Failed to save to localStorage even after cleanup:', retryError);
    }
  },
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('localStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('localStorage removeItem error:', error);
    }
  },
};

/**
 * Composer options captured when a message is queued, so the message can be
 * sent later with the exact settings (model, permission mode, tools) the
 * session's composer had at queue time — even from outside the composer,
 * e.g. the app-level auto-send that fires while another session is viewed.
 */
export type QueuedSendOptions = Record<string, unknown>;

export type StoredQueuedMessage = {
  content: string;
  options?: QueuedSendOptions;
};

export const queuedMessageKey = (sessionId: string) => `${QUEUE_KEY_PREFIX}${sessionId}`;

/**
 * Where a composer's unsent text lives.
 *
 * A draft belongs to the conversation it was typed into, not to the project.
 * Keying it by project meant two sessions in one project shared one slot, so
 * switching between them showed the wrong draft and typing in either silently
 * overwrote the other.
 *
 * A draft can also predate its session: the composer of a not-yet-started chat
 * has a project but no session id. That case keeps the original
 * `draft_input_<projectId>` shape rather than moving to a `p_` prefix, so
 * drafts written by earlier versions still load instead of being orphaned.
 *
 * Both shapes share the `draft_input_` prefix the quota sweeper matches on.
 */
const sessionDraftKey = (sessionId: string) => `${DRAFT_KEY_PREFIX}session_${sessionId}`;

export const draftInputKey = (projectId: string, sessionId?: string | null) =>
  (sessionId ? sessionDraftKey(sessionId) : `${DRAFT_KEY_PREFIX}${projectId}`);

/**
 * The draft slots a completed send retires.
 *
 * Only the conversation that actually held the text is cleared. Once the two
 * key shapes exist side by side, the project slot is no longer a synonym for
 * "this session" — it is the not-yet-started chat's draft, and a send from an
 * established session must leave it alone or it silently deletes text the user
 * typed somewhere else.
 *
 * `settledSessionId` names the session that consumed the text when the caller
 * knows it. On a first send that is the freshly created session, which the
 * composer has not observed as `sessionId` yet.
 */
export function draftKeysToClear(
  projectId: string,
  sessionId?: string | null,
  settledSessionId?: string | null,
): string[] {
  const keys = new Set<string>([draftInputKey(projectId, sessionId)]);
  if (settledSessionId) {
    keys.add(draftInputKey(projectId, settledSessionId));
  }
  return [...keys];
}

/**
 * Reads a session's queued messages, oldest first.
 *
 * Three shapes reach this reader, because the key outlives app versions: the
 * current array, a single `{ content, options }` object, and the original raw
 * draft text. The older two normalize to a one-message queue rather than being
 * dropped — that storage holds a message the user is still waiting on.
 */
export function readQueuedMessages(sessionId: string): StoredQueuedMessage[] {
  const raw = safeLocalStorage.getItem(queuedMessageKey(sessionId));
  if (!raw) {
    return [];
  }

  const normalize = (value: unknown): StoredQueuedMessage | null => {
    if (!value || typeof value !== 'object') return null;
    const { content, options } = value as StoredQueuedMessage;
    if (typeof content !== 'string' || !content.trim()) return null;
    return options === undefined ? { content } : { content, options };
  };

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(normalize).filter((message): message is StoredQueuedMessage => message !== null);
    }
    const single = normalize(parsed);
    if (single) return [single];
  } catch {
    // Legacy format: the raw draft text itself.
  }

  return raw.trim() ? [{ content: raw }] : [];
}

/** Persists the whole queue. An empty queue removes the key, which is the
 * claim ticket the auto-send path and the composer share. */
export function writeQueuedMessages(sessionId: string, messages: StoredQueuedMessage[]): void {
  const kept = messages.filter((message) => message.content.trim());
  if (kept.length === 0) {
    safeLocalStorage.removeItem(queuedMessageKey(sessionId));
    return;
  }
  safeLocalStorage.setItem(queuedMessageKey(sessionId), JSON.stringify(kept));
}

export function clearQueuedMessages(sessionId: string): void {
  safeLocalStorage.removeItem(queuedMessageKey(sessionId));
}

/**
 * Drops everything this module stores for a session that no longer exists.
 *
 * Both keys are session-scoped and nothing else reaps them: a deleted
 * conversation used to leave its draft and its queue behind forever, and the
 * only thing that ever collected them was the quota handler above - which is a
 * failure path, not a lifecycle.
 */
export function forgetSessionStorage(sessionId: string): void {
  safeLocalStorage.removeItem(sessionDraftKey(sessionId));
  safeLocalStorage.removeItem(queuedMessageKey(sessionId));
}

/**
 * Moves one queued message within the queue, which is also the send order.
 * Out-of-range moves return an unchanged copy rather than throwing: the caller
 * is a button that can race a flush that already consumed the head.
 */
export function reorderQueue<T>(queue: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= queue.length || to < 0 || to >= queue.length || from === to) {
    return queue.slice();
  }
  const next = queue.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
