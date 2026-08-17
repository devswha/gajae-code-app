export const safeLocalStorage = {
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (error: any) {
      if (error?.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data');

        const keys = Object.keys(localStorage);
        const draftKeys = keys.filter((k) => k.startsWith('draft_input_') || k.startsWith('queued_message_'));
        draftKeys.forEach((k) => {
          localStorage.removeItem(k);
        });

        try {
          localStorage.setItem(key, value);
        } catch (retryError) {
          console.error('Failed to save to localStorage even after cleanup:', retryError);
        }
      } else {
        console.error('localStorage error:', error);
      }
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

export const queuedMessageKey = (sessionId: string) => `queued_message_${sessionId}`;

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
