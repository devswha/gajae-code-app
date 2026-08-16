import { GaugeIcon } from 'lucide-react';

type ContextUsageBadgeProps = {
  /** Snapshot read off the live session at each turn end; null before the first turn. */
  sessionState: Record<string, unknown> | null;
};

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Compact context-fullness pill for the composer toolbar. Renders only when
 * the session actually reported a context window; there is no fallback size
 * because guessing one would print a confidently wrong percentage.
 */
export default function ContextUsageBadge({ sessionState }: ContextUsageBadgeProps) {
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

  return (
    <span
      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border/70 bg-background/70 px-2 text-xs shadow-sm"
      title={used !== undefined
        ? `Context: ${used.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`
        : `Context window: ${contextWindow.toLocaleString()} tokens`}
      aria-label="Context usage"
    >
      <GaugeIcon className={`h-3.5 w-3.5 ${tone}`} />
      <span className={`font-medium tabular-nums ${tone}`}>{rounded}%</span>
    </span>
  );
}
