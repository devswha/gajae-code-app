import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Shimmer } from '../../../shared/view/ui';
import type { SessionActivity } from '../../../hooks/useSessionProtection';
import { useElapsedSeconds } from '../hooks/useElapsedSeconds';
import { formatElapsed } from '../utils/elapsed';
import { formatLiveActivity } from '../utils/toolActivity';
import type { LiveActivity } from '../utils/toolActivity';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
  /** What the run is doing now, derived from the transcript (`deriveLiveActivity`). */
  liveActivity?: LiveActivity | null;
  onAbort?: () => void;
  isInputFocused?: boolean;
};

const EXIT_ANIMATION_MS = 220;
const THINKING: LiveActivity = { kind: 'thinking' };

/**
 * Minimal response-in-progress indicator, in the spirit of the inline status
 * lines in Claude Code / Codex / OpenCode: a shimmering activity label, the
 * elapsed time, and an interrupt affordance. Rendered only while the viewed
 * session has an entry in the processing map; it disappears the instant that
 * entry is removed.
 *
 * The label is the run's actual activity - the running tool and its subject,
 * a pending approval, or "Thinking" while the model generates - rather than a
 * rotation of decorative verbs. A server status line, when there is one,
 * still takes precedence.
 */
export default function ActivityIndicator({ activity, liveActivity, onAbort, isInputFocused = false }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  const [isExiting, setIsExiting] = useState(false);
  const startedAt = renderedActivity?.startedAt ?? null;
  const elapsedSeconds = useElapsedSeconds(startedAt);

  useEffect(() => {
    if (activity) {
      setRenderedActivity(activity);
      setIsExiting(false);
      return;
    }

    if (!renderedActivity) return;

    setIsExiting(true);
    const timer = setTimeout(() => {
      setRenderedActivity(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);

    return () => clearTimeout(timer);
  }, [activity, renderedActivity]);

  if (!renderedActivity) return null;

  const label = formatLiveActivity(liveActivity ?? THINKING, t);
  const elapsedLabel = formatElapsed(elapsedSeconds, t);
  const tabSurfaceClassName = [
    'chat-activity-tab inline-flex h-8 items-center rounded-b-none rounded-t-lg border border-b-0 bg-card px-3 text-xs transition-all duration-200',
    isInputFocused
      ? 'border-primary/30 shadow-[0_-1px_2px_hsl(var(--foreground)/0.08),1px_0_2px_hsl(var(--foreground)/0.06),-1px_0_2px_hsl(var(--foreground)/0.06)]'
      : 'border-border/50 shadow-[0_-1px_1px_hsl(var(--foreground)/0.04),1px_0_1px_hsl(var(--foreground)/0.03),-1px_0_1px_hsl(var(--foreground)/0.03)]',
  ].join(' ');

  return (
    <div
      className={`pointer-events-none bg-transparent ${
        isExiting ? 'chat-activity-exit' : 'chat-activity-enter'
      }`}
    >
      <div className="flex items-end justify-between gap-2">
        <div className={`${tabSurfaceClassName} min-w-0 gap-2`}>
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
          {/* The label is the live region; the ticking timer beside it is not. */}
          <span role="status" className="min-w-0 truncate">
            <Shimmer className="max-w-full truncate font-medium">{`${label}…`}</Shimmer>
          </span>
          <span className="shrink-0 text-muted-foreground/60 tabular-nums">{elapsedLabel}</span>
        </div>

        {renderedActivity.canInterrupt && onAbort && (
          <button
            type="button"
            onClick={onAbort}
            className={`${tabSurfaceClassName} pointer-events-auto shrink-0 gap-1.5 text-muted-foreground hover:bg-card hover:text-destructive`}
            aria-label={t('claudeStatus.stop', { defaultValue: 'Stop' })}
          >
            <svg className="h-2.5 w-2.5 fill-current" viewBox="0 0 24 24" aria-hidden>
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
            <span>{t('claudeStatus.stop', { defaultValue: 'Stop' })}</span>
            <kbd className="hidden rounded border border-border/60 px-1 text-[10px] text-muted-foreground/70 sm:inline-block">
              esc
            </kbd>
          </button>
        )}
      </div>
    </div>
  );
}
