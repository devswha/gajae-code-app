import {
  clampQuotaPercent,
  representativeQuotaWindow,
  type ProviderQuotaEntry,
  type ProviderQuotaWindow,
} from '../../../../shared/providerQuota';

/** Below this the arc is short enough that emphasis is warranted. */
export const QUOTA_LOW_REMAINING_PERCENT = 10;

export type QuotaWindowView = {
  id: string;
  label: string;
  /** Whole percent, already clamped; absent when the provider reported none. */
  remainingPercent?: number;
  /** Fallback detail for providers that report counts rather than a share. */
  amount?: string;
  /** Compact countdown such as `2h 14m`; absent once the window has rolled over. */
  resetsIn?: string;
};

const UNITS = [
  { limit: 1_000_000_000, suffix: 'B' },
  { limit: 1_000_000, suffix: 'M' },
  { limit: 1_000, suffix: 'K' },
] as const;

function compactNumber(value: number): string {
  const magnitude = Math.abs(value);
  for (const unit of UNITS) {
    if (magnitude >= unit.limit) {
      const scaled = value / unit.limit;
      return `${scaled >= 100 ? Math.round(scaled) : Number(scaled.toFixed(1))}${unit.suffix}`;
    }
  }
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}`;
}

/**
 * Compact time until a window rolls over. Two units, because a single rounded
 * unit reads the same at six and at seven days.
 */
export function quotaResetCountdown(resetAt: string | undefined, now: number): string | undefined {
  if (!resetAt) return undefined;
  const resetsAt = Date.parse(resetAt);
  if (!Number.isFinite(resetsAt) || resetsAt <= now) return undefined;

  const totalMinutes = Math.floor((resetsAt - now) / 60_000);
  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 48) {
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

function amountOf(window: ProviderQuotaWindow): string | undefined {
  if (window.used === undefined && window.limit === undefined) return undefined;
  const unit = window.unit && window.unit !== 'percent' ? ` ${window.unit}` : '';
  if (window.used !== undefined && window.limit !== undefined) {
    return `${compactNumber(window.used)} / ${compactNumber(window.limit)}${unit}`;
  }
  const value = window.used ?? window.limit!;
  return `${compactNumber(value)}${unit}`;
}

/** Presentation view of every window a provider exposes, in reported order. */
export function quotaWindowViews(entry: ProviderQuotaEntry, now: number): QuotaWindowView[] {
  return entry.windows.map((window) => {
    const remainingPercent = clampQuotaPercent(window.remainingPercent);
    const amount = amountOf(window);
    const resetsIn = quotaResetCountdown(window.resetAt, now);
    return {
      id: window.id,
      label: window.label,
      ...(remainingPercent === undefined ? {} : { remainingPercent: Math.round(remainingPercent) }),
      ...(amount === undefined ? {} : { amount }),
      ...(resetsIn === undefined ? {} : { resetsIn }),
    };
  });
}

/**
 * The value the ring draws: the lowest remaining window, so the indicator is
 * conservative about which limit gets hit first. Only `ok` carries a value —
 * `unsupported`, `reauth` and `error` must never read as a low quota.
 */
export function quotaRingPercent(entry: ProviderQuotaEntry): number | undefined {
  if (entry.status !== 'ok') return undefined;
  return clampQuotaPercent(representativeQuotaWindow(entry.windows)?.remainingPercent);
}

/** Which logo the app owns for a runtime provider id; `null` means use a monogram. */
export function quotaProviderLogoId(provider: string): 'claude' | 'codex' | null {
  if (provider === 'anthropic') return 'claude';
  if (provider === 'openai-codex' || provider === 'openai-codex-device' || provider === 'opencodex') return 'codex';
  return null;
}
