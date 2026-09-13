/**
 * Builds the app's normalized provider quota snapshot from the GJC runtime's
 * own usage source.
 *
 * `/usage` is owned by the bundled runtime and reads the account inventory,
 * which projects `AuthStorage`'s `UsageReport` cache. This module consumes the
 * same structured reports rather than the command's rendered text, so the
 * sidebar indicator and `/usage` can never disagree and `/usage` itself is
 * untouched.
 *
 * Everything here is pure apart from the injected `fetchProviderUsage`, so the
 * selection, clamping, state classification and per-provider failure isolation
 * are testable without a worker, an SDK, or a network.
 */

import {
  boundProviderQuotaWindows,
  clampQuotaPercent,
  providerQuotaDisplayName,
  representativeQuotaWindow,
  type ProviderQuotaEntry,
  type ProviderQuotaReason,
  type ProviderQuotaSnapshot,
  type ProviderQuotaStatus,
  type ProviderQuotaWindow,
} from '../shared/providerQuota.js';

/** Matches the runtime's per-credential usage TTL; older observations are stale. */
export const PROVIDER_QUOTA_FRESH_MS = 5 * 60_000;

/** Structural narrowing of the runtime's `UsageLimit`; nothing secret is read. */
export type ProviderUsageLimitLike = {
  id?: unknown;
  label?: unknown;
  window?: { id?: unknown; label?: unknown; durationMs?: unknown; resetsAt?: unknown } | null;
  amount?: {
    used?: unknown;
    limit?: unknown;
    remaining?: unknown;
    usedFraction?: unknown;
    remainingFraction?: unknown;
    unit?: unknown;
  } | null;
  status?: unknown;
};

/** Structural narrowing of the runtime's `SafeUsageReport` (never carries `raw`). */
export type ProviderUsageReportLike = {
  provider?: unknown;
  fetchedAt?: unknown;
  limits?: readonly ProviderUsageLimitLike[];
  metadata?: Record<string, unknown>;
};

/** Structural narrowing of one `AccountInventoryRow`. */
export type ProviderQuotaInventoryRow = {
  provider: string;
  disabled: boolean;
  disabledCause?: string | null;
  health?: { status?: unknown; reason?: unknown } | null;
  usage?: { report: ProviderUsageReportLike; fetchedAt?: unknown; freshness?: unknown } | null;
};

export type ProviderQuotaBuildInput = {
  rows: readonly ProviderQuotaInventoryRow[];
  /**
   * Refreshes one provider's reports. Rejections are contained per provider:
   * one failing provider must never blank the rest of the row.
   */
  fetchProviderUsage: (provider: string) => Promise<readonly ProviderUsageReportLike[] | null | undefined>;
  now?: number;
};

/**
 * Plan identifiers the providers actually emit (`pro`, `plus`, `max_20x`).
 * Whitespace is refused on purpose: it is what lets an arbitrary metadata
 * string — `Bearer <token>`, an error sentence — masquerade as a plan.
 */
const PLAN_LABEL = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,23}$/u;
const WINDOW_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Percentages are display values; binary-float noise must not cross the wire. */
const percent = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : Math.round(value * 100) / 100;

const text = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/gu, ' ').trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : undefined;
};

/** Identifiers are rejected when oversized; truncating them could merge limits. */
const identifier = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string' || value.length > maxLength) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Derives the remaining share from whichever shape the provider reported.
 * Providers disagree on which fields they populate, so every equivalent
 * expression is accepted and the result is clamped once, here.
 */
function remainingPercentOf(amount: NonNullable<ProviderUsageLimitLike['amount']>): number | undefined {
  const remainingFraction = finite(amount.remainingFraction);
  if (remainingFraction !== undefined) return percent(clampQuotaPercent(remainingFraction * 100));

  const usedFraction = finite(amount.usedFraction);
  if (usedFraction !== undefined) return percent(clampQuotaPercent(100 - usedFraction * 100));

  const limit = finite(amount.limit);
  const remaining = finite(amount.remaining);
  if (remaining !== undefined && limit !== undefined && limit > 0) {
    return percent(clampQuotaPercent((remaining / limit) * 100));
  }

  const used = finite(amount.used);
  if (used !== undefined && limit !== undefined && limit > 0) {
    return percent(clampQuotaPercent(100 - (used / limit) * 100));
  }
  // A percent-unit limit reports `used` as the percentage itself.
  if (used !== undefined && amount.unit === 'percent') return percent(clampQuotaPercent(100 - used));

  return undefined;
}

/** Projects one runtime limit onto the renderer-facing window shape. */
export function normalizeQuotaWindow(limit: ProviderUsageLimitLike, index: number): ProviderQuotaWindow | null {
  const amount = limit.amount ?? {};
  const hasLimitId = limit.id !== undefined && limit.id !== null;
  const limitId = identifier(limit.id, 64);
  const windowId = identifier(limit.window?.id, 64);
  const id = limitId !== undefined && WINDOW_ID.test(limitId)
    ? limitId
    : hasLimitId
      ? `window-${index}`
      : windowId !== undefined && WINDOW_ID.test(windowId)
        ? windowId
        : `window-${index}`;
  // A provider can use one duration id for several model or feature limits;
  // the limit label is the useful detail in that case (for example an
  // Antigravity model name or Codex's Spark bucket).
  const label = text(limit.label, 64) ?? text(limit.window?.label, 64) ?? id;
  const remainingPercent = remainingPercentOf(amount);
  const used = finite(amount.used);
  const amountLimit = finite(amount.limit);
  const unit = text(amount.unit, 16);
  const resetsAt = finite(limit.window?.resetsAt);
  const resetAt = resetsAt !== undefined && resetsAt > 0 ? new Date(resetsAt).toISOString() : undefined;

  return {
    id,
    label,
    ...(remainingPercent === undefined ? {} : { remainingPercent }),
    ...(used === undefined ? {} : { used }),
    ...(amountLimit === undefined ? {} : { limit: amountLimit }),
    ...(unit === undefined || unit === 'unknown' ? {} : { unit }),
    ...(resetAt === undefined ? {} : { resetAt }),
  };
}

export function normalizeQuotaWindows(report: ProviderUsageReportLike): ProviderQuotaWindow[] {
  const limits = Array.isArray(report.limits) ? report.limits : [];
  const windows: ProviderQuotaWindow[] = [];
  for (const [index, limit] of limits.entries()) {
    const window = normalizeQuotaWindow(limit, index);
    if (window) windows.push(window);
  }
  return boundProviderQuotaWindows(windows);
}

function planOf(report: ProviderUsageReportLike): string | undefined {
  const planType = report.metadata?.planType ?? report.metadata?.plan;
  const label = text(planType, 40);
  return label !== undefined && PLAN_LABEL.test(label) ? label : undefined;
}

type Observation = {
  windows: ProviderQuotaWindow[];
  fetchedAt: number;
  plan?: string;
  stale: boolean;
};

function observationOf(report: ProviderUsageReportLike, fallbackFetchedAt: number, stale: boolean): Observation {
  const plan = planOf(report);
  return {
    windows: normalizeQuotaWindows(report),
    fetchedAt: finite(report.fetchedAt) ?? fallbackFetchedAt,
    ...(plan === undefined ? {} : { plan }),
    stale,
  };
}

/**
 * Among a provider's accounts, the indicator represents the one with the most
 * headroom: that is the account the runtime's own credential ranking would
 * reach for next, so showing the most-drained account would misstate what the
 * person can actually spend.
 */
function representativeObservation(observations: readonly Observation[]): Observation | undefined {
  let best: Observation | undefined;
  let bestPercent: number | undefined;
  for (const observation of observations) {
    const percent = clampQuotaPercent(representativeQuotaWindow(observation.windows)?.remainingPercent);
    if (best === undefined) {
      best = observation;
      bestPercent = percent;
      continue;
    }
    if (percent === undefined) continue;
    if (bestPercent === undefined || percent > bestPercent) {
      best = observation;
      bestPercent = percent;
    }
  }
  return best;
}

type ProviderGroup = {
  provider: string;
  rows: ProviderQuotaInventoryRow[];
  activeRows: ProviderQuotaInventoryRow[];
  hasAuthFailure: boolean;
  allActiveFailed: boolean;
};

function groupRows(rows: readonly ProviderQuotaInventoryRow[]): ProviderGroup[] {
  const groups = new Map<string, ProviderQuotaInventoryRow[]>();
  for (const row of rows) {
    const provider = text(row.provider, 128);
    if (!provider) continue;
    const existing = groups.get(provider);
    if (existing) existing.push(row);
    else groups.set(provider, [row]);
  }

  return [...groups.entries()]
    .map(([provider, providerRows]) => {
      const activeRows = providerRows.filter((row) => !row.disabled);
      return {
        provider,
        rows: providerRows,
        activeRows,
        hasAuthFailure: providerRows.some((row) => row.disabled && row.disabledCause === 'auth_failure'),
        allActiveFailed: activeRows.length > 0 && activeRows.every((row) => row.health?.status === 'failed'),
      };
    })
    .sort((left, right) => left.provider.localeCompare(right.provider));
}

function cachedObservations(group: ProviderGroup, now: number): Observation[] {
  const observations: Observation[] = [];
  for (const row of group.rows) {
    const usage = row.usage;
    if (!usage?.report) continue;
    const fetchedAt = finite(usage.fetchedAt) ?? finite(usage.report.fetchedAt) ?? 0;
    observations.push(observationOf(usage.report, fetchedAt, usage.freshness !== 'fresh' || now - fetchedAt > PROVIDER_QUOTA_FRESH_MS));
  }
  return observations;
}

function entryOf(
  group: ProviderGroup,
  status: ProviderQuotaStatus,
  reason: ProviderQuotaReason | undefined,
  observation: Observation | undefined,
  now: number,
): ProviderQuotaEntry {
  const fetchedAt = observation?.fetchedAt;
  return {
    provider: group.provider,
    providerName: providerQuotaDisplayName(group.provider),
    ...(observation?.plan === undefined ? {} : { plan: observation.plan }),
    accounts: group.activeRows.length > 0 ? group.activeRows.length : group.rows.length,
    windows: observation?.windows ?? [],
    status,
    ...(reason === undefined ? {} : { reason }),
    stale: observation === undefined ? false : observation.stale || now - observation.fetchedAt > PROVIDER_QUOTA_FRESH_MS,
    fetchedAt: new Date(fetchedAt !== undefined && fetchedAt > 0 ? fetchedAt : now).toISOString(),
  };
}

/**
 * Assembles one snapshot. Providers are refreshed concurrently with settled
 * semantics so a single provider's outage, timeout or re-auth requirement
 * cannot suppress the others.
 */
export async function buildProviderQuotaSnapshot(input: ProviderQuotaBuildInput): Promise<ProviderQuotaSnapshot> {
  const now = input.now ?? Date.now();
  const groups = groupRows(input.rows);
  // A provider is "connected" when it still holds a credential, or when its
  // only credentials were disabled by an auth failure — the latter is exactly
  // the case the re-auth state exists to surface.
  const connected = groups.filter((group) => group.activeRows.length > 0 || group.hasAuthFailure);

  const settled = await Promise.allSettled(
    connected.map(async (group) => {
      if (group.activeRows.length === 0) return null;
      return (await input.fetchProviderUsage(group.provider)) ?? null;
    }),
  );

  const providers = connected.map((group, index) => {
    const cached = cachedObservations(group, now);

    if (group.activeRows.length === 0) {
      return entryOf(group, 'reauth', 'reauth_required', representativeObservation(cached), now);
    }

    const result = settled[index]!;
    if (result.status === 'rejected') {
      // Keep the last-known windows for the tooltip, but never present a
      // failed refresh as a valid quota reading.
      return entryOf(group, 'error', 'fetch_failed', representativeObservation(cached), now);
    }

    const fetched = (result.value ?? []).map((report) => observationOf(report, now, false));
    const observations = fetched.length > 0 ? fetched : cached;

    if (group.allActiveFailed) {
      return entryOf(group, 'reauth', 'reauth_required', representativeObservation(observations), now);
    }
    if (observations.length === 0) {
      return entryOf(group, 'unsupported', 'usage_unsupported', undefined, now);
    }

    const observation = representativeObservation(observations);
    if (!observation || representativeQuotaWindow(observation.windows) === undefined) {
      // Connected and reporting, but not in a proportion this indicator can
      // draw. Show an empty ring rather than inventing a percentage.
      return entryOf(group, 'unsupported', 'no_usage_data', observation, now);
    }
    return entryOf(group, 'ok', undefined, observation, now);
  });

  return { providers: providers.sort(compareForDisplay), fetchedAt: new Date(now).toISOString() };
}

/**
 * Display order for the compact row.
 *
 * A person may have many connected providers while only a few expose a quota
 * at all, so the ones that actually draw an arc come first and the permanently
 * quota-less ones trail off into the row's overflow. Ordering is by state
 * rather than by remaining share on purpose: an ambient indicator that
 * reshuffles itself as quotas move is unreadable, so within a state the order
 * is stable and alphabetical.
 */
const STATUS_ORDER: Readonly<Record<ProviderQuotaStatus, number>> = {
  ok: 0,
  reauth: 1,
  error: 2,
  unsupported: 3,
};

function compareForDisplay(left: ProviderQuotaEntry, right: ProviderQuotaEntry): number {
  const byStatus = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
  return byStatus !== 0 ? byStatus : left.provider.localeCompare(right.provider);
}
