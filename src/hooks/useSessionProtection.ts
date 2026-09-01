import { useCallback, useState } from 'react';

export interface SessionActivity {
  statusText: string | null;
  canInterrupt: boolean;
  startedAt: number;
}

export type SessionActivityMap = ReadonlyMap<string, SessionActivity>;
export type SessionActivitySnapshot = { sessionId: string; statusText?: string | null; canInterrupt?: boolean; startedAt?: number };
export type MarkSessionProcessing = (sessionId?: string | null, activity?: { statusText?: string | null; canInterrupt?: boolean }) => void;
export type MarkSessionIdle = (sessionId?: string | null, opts?: { ifStartedBefore?: number }) => void;
export type SyncProcessingSessions = (sessions: readonly SessionActivitySnapshot[]) => void;

const LOCAL_ACTIVITY_GRACE_MS = 10_000;

function sameActivityMap(current: ReadonlyMap<string, SessionActivity>, replacement: ReadonlyMap<string, SessionActivity>) {
  if (current.size !== replacement.size) return false;
  for (const [id, activity] of current) {
    const candidate = replacement.get(id);
    if (!candidate || candidate.statusText !== activity.statusText || candidate.canInterrupt !== activity.canInterrupt || candidate.startedAt !== activity.startedAt) return false;
  }
  return true;
}

function validStart(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function materializeSnapshot(snapshot: SessionActivitySnapshot, previous: SessionActivity | undefined, now: number): SessionActivity {
  return {
    statusText: snapshot.statusText === undefined ? previous?.statusText ?? null : snapshot.statusText,
    canInterrupt: snapshot.canInterrupt ?? previous?.canInterrupt ?? true,
    startedAt: validStart(snapshot.startedAt) ? snapshot.startedAt : previous?.startedAt ?? now,
  };
}

export function useSessionProtection() {
  const [processingSessions, setProcessingSessions] = useState<Map<string, SessionActivity>>(() => new Map());

  const markSessionProcessing = useCallback<MarkSessionProcessing>((sessionId, update) => {
    if (!sessionId) return;
    setProcessingSessions((current) => {
      const before = current.get(sessionId);
      const after: SessionActivity = {
        statusText: update?.statusText === undefined ? before?.statusText ?? null : update.statusText,
        canInterrupt: update?.canInterrupt ?? before?.canInterrupt ?? true,
        startedAt: before?.startedAt ?? Date.now(),
      };
      if (before?.statusText === after.statusText && before.canInterrupt === after.canInterrupt) return current;
      const next = new Map(current);
      next.set(sessionId, after);
      return next;
    });
  }, []);

  const markSessionIdle = useCallback<MarkSessionIdle>((sessionId, options) => {
    if (!sessionId) return;
    setProcessingSessions((current) => {
      const active = current.get(sessionId);
      if (!active || (options?.ifStartedBefore !== undefined && active.startedAt >= options.ifStartedBefore)) return current;
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const syncProcessingSessions = useCallback<SyncProcessingSessions>((snapshots) => {
    const polledAt = Date.now();
    setProcessingSessions((current) => {
      const reported = new Map<string, SessionActivitySnapshot>();
      snapshots.forEach((snapshot) => {
        if (snapshot.sessionId) reported.set(snapshot.sessionId, snapshot);
      });
      const next = new Map<string, SessionActivity>();
      reported.forEach((snapshot, sessionId) => {
        next.set(sessionId, materializeSnapshot(snapshot, current.get(sessionId), polledAt));
      });
      current.forEach((activity, sessionId) => {
        if (!reported.has(sessionId) && polledAt - activity.startedAt < LOCAL_ACTIVITY_GRACE_MS) next.set(sessionId, activity);
      });
      return sameActivityMap(current, next) ? current : next;
    });
  }, []);

  return { processingSessions, markSessionProcessing, markSessionIdle, syncProcessingSessions };
}
