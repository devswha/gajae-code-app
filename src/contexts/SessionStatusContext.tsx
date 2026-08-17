import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  EMPTY_SESSION_STATUS,
  sameSessionStatus,
  type SessionStatusSnapshot,
} from './sessionStatusSnapshot';

type SessionStatusStore = {
  snapshot: SessionStatusSnapshot;
  publish: (snapshot: SessionStatusSnapshot) => void;
};

const SessionStatusContext = createContext<SessionStatusStore | null>(null);

/**
 * Carries the live session's status from the chat, which receives it, to the
 * Workspace Status tab, which renders it.
 *
 * The two live in sibling subtrees, so the chat publishes and the panel
 * subscribes. Publishing is idempotent: an unchanged snapshot never reaches
 * setState, so a chat re-render does not re-render the panel.
 */
export function SessionStatusProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<SessionStatusSnapshot>(EMPTY_SESSION_STATUS);

  const publish = useCallback((next: SessionStatusSnapshot) => {
    setSnapshot((previous) => (sameSessionStatus(previous, next) ? previous : next));
  }, []);

  const store = useMemo<SessionStatusStore>(() => ({ snapshot, publish }), [publish, snapshot]);

  return <SessionStatusContext.Provider value={store}>{children}</SessionStatusContext.Provider>;
}

export function useSessionStatus(): SessionStatusSnapshot {
  return useContext(SessionStatusContext)?.snapshot ?? EMPTY_SESSION_STATUS;
}

/**
 * Publishes the snapshot for as long as the caller is mounted, and clears it on
 * unmount so a closed chat cannot leave stale status on screen.
 */
export function usePublishSessionStatus(snapshot: SessionStatusSnapshot): void {
  const store = useContext(SessionStatusContext);
  const publish = store?.publish;

  useEffect(() => {
    publish?.(snapshot);
  }, [publish, snapshot]);

  useEffect(() => () => publish?.(EMPTY_SESSION_STATUS), [publish]);
}
