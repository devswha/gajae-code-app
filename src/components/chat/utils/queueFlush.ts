/**
 * When the composer may send the head of a session's queue.
 *
 * Pulled out of the effect because the answer is the correctness-relevant part:
 * a queue holds several follow-ups, and each one has to wait for the previous
 * one's turn. Getting this wrong empties the whole queue into a single burst.
 */

export const QUEUE_FLUSH_DELAY_AFTER_TURN_MS = 0;
/**
 * A queue restored into an apparently idle session waits this long first, so a
 * `chat_subscribed` ack that reveals a still-live run can cancel the send.
 */
export const QUEUE_FLUSH_DELAY_ON_RESTORE_MS = 750;

export type QueueFlushDecision =
  | { action: 'flush'; delayMs: number }
  | { action: 'skip'; reason: 'session-switched' | 'run-in-flight' | 'empty' | 'awaiting-dispatch' | 'composer-has-input' };

export type QueueFlushInput = {
  /** The effect is running across a session change, so `isLoading` describes another session. */
  sessionSwitched: boolean;
  isLoading: boolean;
  /** `isLoading` on the previous evaluation, which is what makes a turn's end recognizable. */
  wasLoading: boolean;
  queueLength: number;
  /** A previous flush was dispatched and has not become a run yet. */
  awaitingDispatchedTurn: boolean;
  /** The user has text in the composer right now. */
  composerHasInput: boolean;
};

export function decideQueueFlush({
  sessionSwitched,
  isLoading,
  wasLoading,
  queueLength,
  awaitingDispatchedTurn,
  composerHasInput,
}: QueueFlushInput): QueueFlushDecision {
  if (sessionSwitched) {
    return { action: 'skip', reason: 'session-switched' };
  }

  if (isLoading) {
    return { action: 'skip', reason: 'run-in-flight' };
  }

  if (queueLength === 0) {
    return { action: 'skip', reason: 'empty' };
  }

  // The dispatch does not flip `isLoading` synchronously, so without this the
  // next render would see an idle session and send the following message on top
  // of a turn that has not started.
  if (awaitingDispatchedTurn) {
    return { action: 'skip', reason: 'awaiting-dispatch' };
  }

  // Flushing seeds the composer with the queued text and submits it, which
  // would silently discard whatever the user is typing — including a message
  // they just pulled back out of the queue to edit. Their typing wins; the
  // queue resumes after they send or clear it.
  if (composerHasInput) {
    return { action: 'skip', reason: 'composer-has-input' };
  }

  return {
    action: 'flush',
    delayMs: wasLoading ? QUEUE_FLUSH_DELAY_AFTER_TURN_MS : QUEUE_FLUSH_DELAY_ON_RESTORE_MS,
  };
}
