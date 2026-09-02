import { useEffect, useState } from 'react';

/** Whole seconds since `startedAt`, ticking once a second; 0 when there is no start. */
export function useElapsedSeconds(startedAt: number | null): number {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return startedAt === null ? 0 : elapsedSeconds;
}
