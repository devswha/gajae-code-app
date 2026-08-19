import { GaugeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ContextUsageBadgeProps = {
  /** Snapshot read off the live session at each turn end; null before the first turn. */
  sessionState: Record<string, unknown> | null;
  onClick?: () => void;
};

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Compact context-fullness pill for the composer toolbar. Renders only when
 * the session actually reported a context window; there is no fallback size
 * because guessing one would print a confidently wrong percentage.
 */
export default function ContextUsageBadge({ sessionState, onClick }: ContextUsageBadgeProps) {
  const { t } = useTranslation('common');
  const percent = finite(sessionState?.contextPercent);
  const contextWindow = finite(sessionState?.contextWindow);
  if (percent === undefined || contextWindow === undefined) return null;

  const used = finite(sessionState?.contextTokens);
  const rounded = Math.round(percent);
  const tone = rounded >= 90
    ? 'text-red-500'
    : rounded >= 70
      ? 'text-amber-500'
      : 'text-muted-foreground';
  const label = t('workspace.statusTab.context');

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs shadow-sm transition-colors hover:border-primary/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      title={used !== undefined
        ? `${label}: ${used.toLocaleString()} / ${contextWindow.toLocaleString()} ${t('workspace.statusTab.tokens').toLowerCase()}`
        : `${t('workspace.statusTab.contextWindow')}: ${contextWindow.toLocaleString()} ${t('workspace.statusTab.tokens').toLowerCase()}`}
      aria-label={`${label} ${rounded}%`}
    >
      <GaugeIcon className={`h-3.5 w-3.5 ${tone}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${tone}`}>{rounded}%</span>
    </button>
  );
}
