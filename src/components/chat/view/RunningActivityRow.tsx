import { useTranslation } from 'react-i18next';

import { Shimmer } from '../../../shared/view/ui';
import { useElapsedSeconds } from '../hooks/useElapsedSeconds';
import { formatElapsed } from '../utils/elapsed';
import { formatLiveActivity } from '../utils/toolActivity';
import type { LiveActivity } from '../utils/toolActivity';

interface RunningActivityRowProps {
  /** What the run is doing now; `Thinking` when nothing is derived yet. */
  liveActivity?: LiveActivity | null;
  /** When the run started (client clock); no timer without it. */
  runStartedAt?: number | null;
  /** Which fold this row stands in for, for tests and styling hooks. */
  variant?: 'pending-block' | 'inline';
}

const SEPARATOR = ' · ';
const THINKING: LiveActivity = { kind: 'thinking' };

/**
 * One line for a run that has no work block to speak for it: the live turn
 * before its first tool call (`Thinking… · 3s`), and every live turn at
 * detailed density, where blocks are off (`Reading src/foo.ts… · 12s`). It
 * sits in the transcript where the block sits, never above the composer, and
 * leaves the chevron's width empty so the pulse lines up with the block that
 * replaces it once a call lands. The label is the live region; the ticking
 * timer beside it is not.
 */
export default function RunningActivityRow({ liveActivity, runStartedAt = null, variant = 'inline' }: RunningActivityRowProps) {
  const { t } = useTranslation('chat');
  const elapsedSeconds = useElapsedSeconds(runStartedAt);
  const label = formatLiveActivity(liveActivity ?? THINKING, t);

  return (
    <div className="chat-message tool px-3 sm:px-0" data-run-activity={variant}>
      <div className="flex items-center gap-2 px-1 py-0.5 text-xs">
        <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
        <span role="status" className="min-w-0 truncate text-muted-foreground">
          <Shimmer className="max-w-full truncate font-medium">{`${label}…`}</Shimmer>
        </span>
        {runStartedAt !== null && (
          <span className="shrink-0 text-muted-foreground tabular-nums">
            <span aria-hidden>{SEPARATOR}</span>
            {formatElapsed(elapsedSeconds, t)}
          </span>
        )}
      </div>
    </div>
  );
}
