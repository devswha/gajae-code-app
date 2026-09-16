import { randomUUID } from 'node:crypto';

/**
 * Progress for a clone that has already been started.
 *
 * Starting a clone used to be the GET that streamed its progress, which made
 * "clone this URL into this directory" a cross-site navigation away: desktop
 * cookies are SameSite=Lax, so a top-level GET from any page carried them.
 * Starting is a POST now, and this registry is what lets the progress stream
 * stay a read.
 *
 * Events are buffered from the moment the clone starts, so the caller loses
 * nothing between the POST returning and the stream attaching, and a reader
 * that disconnects can attach again. The clone itself is not tied to a
 * reader's lifetime: it runs to completion either way.
 */
export type CloneProgressEvent = { type: 'progress' | 'complete' | 'error'; [key: string]: unknown };
type CloneListener = { onEvent: (event: CloneProgressEvent) => void; onFinished: () => void };
type CloneStream = {
  events: CloneProgressEvent[];
  listeners: Set<CloneListener>;
  finished: boolean;
  expiry?: NodeJS.Timeout;
};

/** Enough to carry a full `git clone --progress` run; a stuck clone cannot grow without bound. */
const MAX_BUFFERED_EVENTS = 500;
/** A finished clone stays readable long enough for a reconnecting reader, then is forgotten. */
const COMPLETED_RETENTION_MS = 10 * 60 * 1000;

const streams = new Map<string, CloneStream>();

export function createCloneProgressStream(): { cloneId: string; publish: (event: CloneProgressEvent) => void; finish: () => void } {
  const cloneId = randomUUID();
  const stream: CloneStream = { events: [], listeners: new Set(), finished: false };
  streams.set(cloneId, stream);
  return {
    cloneId,
    publish: (event) => {
      if (stream.finished) return;
      if (stream.events.length < MAX_BUFFERED_EVENTS) stream.events.push(event);
      for (const listener of stream.listeners) listener.onEvent(event);
    },
    finish: () => {
      if (stream.finished) return;
      stream.finished = true;
      // A reader attached to a live clone is told the stream is over, or it
      // waits on a response body that will never produce another byte.
      for (const listener of [...stream.listeners]) listener.onFinished();
      stream.listeners.clear();
      stream.expiry = setTimeout(() => streams.delete(cloneId), COMPLETED_RETENTION_MS);
      stream.expiry.unref?.();
    },
  };
}

/**
 * Replays what the clone has reported so far and follows it live.
 * Returns null when no such clone exists (or its retention window passed).
 */
export function readCloneProgress(cloneId: string, listener: CloneListener): { finished: boolean; unsubscribe: () => void } | null {
  const stream = streams.get(cloneId);
  if (!stream) return null;
  for (const event of stream.events) listener.onEvent(event);
  if (stream.finished) return { finished: true, unsubscribe: () => {} };
  stream.listeners.add(listener);
  return { finished: false, unsubscribe: () => { stream.listeners.delete(listener); } };
}

/** Test seam: drops every stream and its retention timer. */
export function resetCloneProgressStreams(): void {
  for (const stream of streams.values()) if (stream.expiry) clearTimeout(stream.expiry);
  streams.clear();
}
