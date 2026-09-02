import type { TFunction } from 'i18next';

import { SESSION_STATUS_PRIORITY, type SessionStatus } from '../../../stores/sessionStatusModel';
import { cn } from '../../../utils/cn';
import type { WorkCounts } from '../utils/workList';

type SidebarWorkCountsProps = {
  readonly counts: WorkCounts;
  readonly t: TFunction;
};

const COUNT_KEYS: Record<Exclude<SessionStatus, 'idle'>, string> = {
  needs_input: 'status.countNeedsInput',
  blocked: 'status.countBlocked',
  ready: 'status.countReady',
  running: 'status.countRunning',
};

const DOT_CLASS: Record<Exclude<SessionStatus, 'idle'>, string> = {
  needs_input: 'bg-primary animate-pulse',
  blocked: 'bg-destructive',
  ready: 'bg-primary',
  running: 'bg-muted-foreground',
};

/**
 * Per-state counts in the Work heading. Zero counts are omitted, and the whole
 * strip disappears when nothing is happening, so the heading only ever carries
 * numbers worth reading.
 */
export default function SidebarWorkCounts({ counts, t }: SidebarWorkCountsProps) {
  const shown = SESSION_STATUS_PRIORITY
    .filter((status): status is Exclude<SessionStatus, 'idle'> => status !== 'idle' && counts[status] > 0);
  if (shown.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-1.5 pr-1" data-testid="sidebar-work-counts">
      {shown.map((status) => {
        const label = t(COUNT_KEYS[status], { count: counts[status] });
        return (
          <span
            key={status}
            role="status"
            aria-label={label}
            title={label}
            data-session-status={status}
            className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground tabular-nums"
          >
            <span className={cn('size-1.5 rounded-full', DOT_CLASS[status])} aria-hidden />
            {counts[status]}
          </span>
        );
      })}
    </div>
  );
}
