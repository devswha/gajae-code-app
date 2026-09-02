import { CircleAlert, Loader2, TriangleAlert } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Tooltip } from '../../../shared/view/ui';
import type { SessionStatus } from '../../../stores/sessionStatusModel';
import { cn } from '../../../utils/cn';

const LABEL_KEYS: Record<Exclude<SessionStatus, 'idle'>, string> = {
  running: 'status.running',
  needs_input: 'status.needsInput',
  ready: 'status.ready',
  blocked: 'status.blocked',
};

export function sessionStatusLabel(status: SessionStatus, t: TFunction): string | null {
  return status === 'idle' ? null : t(LABEL_KEYS[status]);
}

type IndicatorProps = { status: SessionStatus; t: TFunction; className?: string };

/**
 * The unread marker on the row's leading edge. Only the three states that ask
 * something of the user get one; a running row already has its spinner and an
 * idle row has nothing to say.
 */
export function SessionStatusDot({ status, t, className }: IndicatorProps) {
  if (status === 'idle' || status === 'running') return null;
  const label = sessionStatusLabel(status, t);
  return (
    <div className={cn('absolute top-1/2 left-0 -translate-x-1 -translate-y-1/2 transform', className)}>
      <Tooltip content={label} position="right">
        <div
          role="status"
          aria-label={label ?? undefined}
          data-session-status={status}
          className={cn(
            'h-2 w-2 rounded-full',
            status === 'needs_input' && 'animate-pulse bg-primary',
            status === 'blocked' && 'bg-destructive',
            status === 'ready' && 'bg-primary',
          )}
        />
      </Tooltip>
    </div>
  );
}

/**
 * The trailing glyph, where the row otherwise shows its age. Returns null for
 * `ready` and `idle` so the caller falls back to the timestamp: a finished run
 * is announced by the dot alone and the row stays quiet.
 */
export function SessionStatusGlyph({ status, t, className }: IndicatorProps) {
  if (status === 'idle' || status === 'ready') return null;
  const label = sessionStatusLabel(status, t);
  const Icon = status === 'running' ? Loader2 : status === 'needs_input' ? CircleAlert : TriangleAlert;
  return (
    <span className={cn('ml-auto shrink-0', className)}>
      <Tooltip content={label} position="top">
        <span
          role="status"
          aria-label={label ?? undefined}
          data-session-status={status}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-md',
            status === 'running' && 'text-muted-foreground',
            status === 'needs_input' && 'text-primary',
            status === 'blocked' && 'text-destructive',
          )}
        >
          <Icon className={cn('h-3 w-3', status === 'running' && 'animate-spin')} aria-hidden />
        </span>
      </Tooltip>
    </span>
  );
}
