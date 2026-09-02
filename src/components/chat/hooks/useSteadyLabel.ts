import { useEffect, useState } from 'react';

/** How long a label stays on screen before the next one may replace it. */
export const STEADY_LABEL_MS = 900;

/**
 * The status line's label, held long enough to be read.
 *
 * The runtime reports phases that can last a few frames - a retry that
 * succeeds at once, a compaction that had nothing to do, a first text
 * fragment before a tool call - and painting each one the moment it arrives
 * flashed unreadable text through `Thinking…`. A label that has been on
 * screen for less than `STEADY_LABEL_MS` keeps its place; the newest label
 * takes over when that time is up. Only the latest is ever pending, so a
 * burst of changes settles on the last one, not on a queue of them.
 *
 * In development every requested change is logged as it arrives - including
 * one that is withdrawn before it is shown - so a flash can be named after
 * the fact.
 */
export function useSteadyLabel(label: string): string {
  const [shown, setShown] = useState({ label, since: Date.now() });

  useEffect(() => {
    if (label === shown.label) return;
    const remaining = STEADY_LABEL_MS - (Date.now() - shown.since);
    if (import.meta.env.DEV) {
      console.debug(`[chat] status ${JSON.stringify(shown.label)} -> ${JSON.stringify(label)}${remaining > 0 ? ` (held ${remaining}ms)` : ''}`);
    }
    const swap = () => setShown({ label, since: Date.now() });
    if (remaining <= 0) {
      swap();
      return;
    }
    const timer = setTimeout(swap, remaining);
    return () => clearTimeout(timer);
  }, [label, shown]);

  return shown.label;
}
