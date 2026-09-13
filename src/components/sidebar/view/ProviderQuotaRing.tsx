import type { TFunction } from 'i18next';

import SessionProviderLogo from '../../llm-logo-provider/SessionProviderLogo';
import Tooltip from '../../../shared/view/ui/Tooltip';
import { cn } from '../../../utils/cn';
import type { ProviderQuotaEntry } from '../../../../shared/providerQuota';

import {
  QUOTA_LOW_REMAINING_PERCENT,
  quotaProviderLogoId,
  quotaRingPercent,
  quotaWindowViews,
} from './providerQuotaFormat';

const SIZE = 22;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/**
 * A dashed track separates "this provider reports no quota" from "this quota is
 * spent". Both draw no arc, so without a difference in the track itself an
 * unsupported provider would read as an empty one — and the difference has to
 * be in the shape, because colour alone cannot carry it.
 */
const TRACK_DASH = `${(CIRCUMFERENCE / 16).toFixed(2)} ${(CIRCUMFERENCE / 16).toFixed(2)}`;

type ProviderQuotaRingProps = {
  entry: ProviderQuotaEntry;
  /** Injected so the countdown is deterministic under test. */
  now?: number;
  tooltipPosition?: 'top' | 'right';
  t: TFunction;
};

function ProviderGlyph({ entry }: { entry: ProviderQuotaEntry }) {
  const logoId = quotaProviderLogoId(entry.provider);
  if (logoId) return <SessionProviderLogo provider={logoId} className="size-3" />;
  return (
    <span aria-hidden className="text-[8px] leading-none font-semibold text-muted-foreground">
      {entry.providerName.slice(0, 2).toUpperCase()}
    </span>
  );
}

function StatusNote({ entry, t }: { entry: ProviderQuotaEntry; t: TFunction }) {
  if (entry.status === 'reauth') return <span className="text-destructive">{t('providerQuota.reauth')}</span>;
  if (entry.status === 'error') return <span className="text-muted-foreground">{t('providerQuota.error')}</span>;
  if (entry.status === 'unsupported') return <span className="text-muted-foreground">{t('providerQuota.unsupported')}</span>;
  if (entry.stale) return <span className="text-muted-foreground">{t('providerQuota.stale')}</span>;
  return null;
}

/**
 * One provider's ambient quota indicator: the provider mark inside a thin ring
 * whose arc is the remaining share of the window that runs out first.
 *
 * The arc length carries the meaning; colour only emphasises an almost-spent
 * quota. Loading, unsupported, re-auth and error all render at the same size
 * with no arc, so the footer never shifts and no percentage is invented.
 */
export default function ProviderQuotaRing({ entry, now = Date.now(), tooltipPosition = 'top', t }: ProviderQuotaRingProps) {
  const remaining = quotaRingPercent(entry);
  const windows = quotaWindowViews(entry, now);
  const isLow = remaining !== undefined && remaining <= QUOTA_LOW_REMAINING_PERCENT;
  const hasReading = entry.status === 'ok';
  const center = SIZE / 2;

  const summary = remaining === undefined
    ? entry.providerName
    : t('providerQuota.summary', { provider: entry.providerName, percent: Math.round(remaining) });

  const tooltip = (
    <div className="flex flex-col gap-1 py-0.5 text-left">
      <div className="font-semibold">
        {entry.providerName}
        {entry.plan ? <span className="ml-1 font-normal text-muted-foreground">{entry.plan}</span> : null}
      </div>
      {windows.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {windows.map((window) => (
            <li key={window.id} className="flex flex-col">
              <span className="text-muted-foreground">{window.label}</span>
              <span>
                {window.remainingPercent === undefined
                  ? window.amount ?? t('providerQuota.noWindowData')
                  : t('providerQuota.remaining', { percent: window.remainingPercent })}
                {window.resetsIn ? ` · ${t('providerQuota.resetsIn', { duration: window.resetsIn })}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {entry.accounts > 1 ? (
        <div className="text-muted-foreground">{t('providerQuota.accounts', { count: entry.accounts })}</div>
      ) : null}
      <StatusNote entry={entry} t={t} />
    </div>
  );

  return (
    <Tooltip content={tooltip} position={tooltipPosition} className="whitespace-normal">
      <span
        role="img"
        aria-label={summary}
        data-testid={`quota-ring-${entry.provider}`}
        className={cn('relative flex shrink-0 items-center justify-center', hasReading ? '' : 'opacity-60')}
        style={{ width: SIZE, height: SIZE }}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden>
          <circle
            cx={center}
            cy={center}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-border"
            data-testid={`quota-track-${entry.provider}`}
            {...(hasReading ? {} : { strokeDasharray: TRACK_DASH })}
          />
          {remaining === undefined ? null : (
            <circle
              cx={center}
              cy={center}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${(CIRCUMFERENCE * remaining) / 100} ${CIRCUMFERENCE}`}
              className={cn('transition-[stroke-dasharray] duration-500', isLow ? 'stroke-destructive' : 'stroke-primary')}
              data-testid={`quota-arc-${entry.provider}`}
              data-remaining={remaining}
            />
          )}
        </svg>
        {/* The ring already carries the accessible name; the mark inside it
            must not announce the provider a second time. */}
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          <ProviderGlyph entry={entry} />
        </span>
        {entry.status === 'reauth' ? (
          <span
            aria-hidden
            data-testid={`quota-reauth-${entry.provider}`}
            className="absolute -right-px -bottom-px size-1.5 rounded-full bg-destructive ring-1 ring-sidebar"
          />
        ) : null}
      </span>
    </Tooltip>
  );
}

/** Fixed-size placeholder so the first fetch cannot shift the footer. */
export function ProviderQuotaRingPlaceholder() {
  const center = SIZE / 2;
  return (
    <span className="flex shrink-0 items-center justify-center opacity-50" style={{ width: SIZE, height: SIZE }} aria-hidden>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={center} cy={center} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-border" />
      </svg>
    </span>
  );
}
