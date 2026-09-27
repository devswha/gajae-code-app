import { useTranslation } from 'react-i18next';

type ContextUsageRingProps = {
  /** Snapshot read off the live session at each turn end; null before the first turn. */
  sessionState: Record<string, unknown> | null;
  onClick?: () => void;
};

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const SIZE = 18;
const CENTER = SIZE / 2;
const TRACK_STROKE = 1.5;
const TRACK_RADIUS = (SIZE - TRACK_STROKE) / 2;
/*
 * The usage is a filled wedge inside a thin outline, drawn as a circle whose
 * stroke is as wide as its diameter. A stroked arc beside the Stop button read
 * as a second loading spinner; a pie reads as an amount, like a battery or a
 * disk gauge.
 */
const PIE_FILL = 6.5;
const PIE_RADIUS = PIE_FILL / 2;
const CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS;

/**
 * Context fullness as a single ring next to the send button. Renders only when
 * the session actually reported a context window; there is no fallback size
 * because guessing one would draw a confidently wrong ring. The exact numbers
 * stay in the title and in the cost modal behind the click, so the composer
 * toolbar carries a gauge rather than a sentence.
 */
export default function ContextUsageRing({ sessionState, onClick }: ContextUsageRingProps) {
  const { t } = useTranslation('common');
  const percent = finite(sessionState?.contextPercent);
  const contextWindow = finite(sessionState?.contextWindow);
  if (percent === undefined || contextWindow === undefined) return null;

  const used = finite(sessionState?.contextTokens);
  const rounded = Math.min(100, Math.max(0, Math.round(percent)));
  // Neutral until the window is actually under pressure: an orange gauge on a
  // half-empty context reads as a warning that is not there.
  const tone = rounded >= 90
    ? 'stroke-destructive'
    : rounded >= 70
      ? 'stroke-primary'
      : 'stroke-foreground/70';
  const label = t('workspace.statusTab.context');
  const tokens = t('workspace.statusTab.tokens').toLowerCase();

  return (
    <button
      type="button"
      onClick={onClick}
      data-slot="context-usage-ring"
      data-context-percent={rounded}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden"
      title={used !== undefined
        ? `${label} ${rounded}% — ${used.toLocaleString()} / ${contextWindow.toLocaleString()} ${tokens}`
        : `${label} ${rounded}% — ${contextWindow.toLocaleString()} ${tokens}`}
      aria-label={`${label} ${rounded}%`}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden>
        <circle cx={CENTER} cy={CENTER} r={TRACK_RADIUS} fill="none" strokeWidth={TRACK_STROKE} className="stroke-muted-foreground/50" />
        {/* Nothing is drawn for an empty context: a fresh session shows the
            outline alone rather than a sliver that reads as usage. */}
        {rounded > 0 && (
          <circle
            cx={CENTER}
            cy={CENTER}
            r={PIE_RADIUS}
            fill="none"
            strokeWidth={PIE_FILL}
            strokeDasharray={`${(CIRCUMFERENCE * rounded) / 100} ${CIRCUMFERENCE}`}
            className={`transition-[stroke-dasharray] duration-500 ${tone}`}
          />
        )}
      </svg>
    </button>
  );
}
