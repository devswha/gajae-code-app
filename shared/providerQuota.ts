/**
 * Normalized provider quota contract shared by the server and the renderer.
 *
 * The GJC runtime already models provider quota as structured data: `/usage`
 * reads `AuthStorage`'s `UsageReport` cache through the account inventory and
 * only then formats text. This module is the app-side projection of that same
 * structured source — a payload-free DTO plus the pure rules both sides must
 * agree on. It deliberately carries no credential, token, account identity, or
 * raw provider response.
 */

export const PROVIDER_QUOTA_STATUSES = ['ok', 'unsupported', 'reauth', 'error'] as const;
export type ProviderQuotaStatus = (typeof PROVIDER_QUOTA_STATUSES)[number];

/**
 * Fixed reason codes. A raw provider/transport message must never cross this
 * boundary, so the renderer maps these to its own copy.
 */
export const PROVIDER_QUOTA_REASONS = [
  'usage_unsupported',
  'no_usage_data',
  'reauth_required',
  'fetch_failed',
] as const;
export type ProviderQuotaReason = (typeof PROVIDER_QUOTA_REASONS)[number];

export type ProviderQuotaWindow = {
  /** Stable id for this window within its provider (for example `5h`, `7d`). */
  id: string;
  label: string;
  /** Already clamped to 0-100 when the provider expressed a proportion. */
  remainingPercent?: number;
  used?: number;
  limit?: number;
  unit?: string;
  /** ISO-8601 instant at which the window rolls over. */
  resetAt?: string;
};

export type ProviderQuotaEntry = {
  /** Runtime provider id, for example `anthropic` or `openai-codex`. */
  provider: string;
  /** Short display label; never an account identity. */
  providerName: string;
  plan?: string;
  /** How many connected accounts this provider has, for the tooltip only. */
  accounts: number;
  windows: ProviderQuotaWindow[];
  status: ProviderQuotaStatus;
  reason?: ProviderQuotaReason;
  /** True when the newest observation is older than the runtime's fresh window. */
  stale: boolean;
  /** ISO-8601 instant the represented observation was taken. */
  fetchedAt: string;
};

export type ProviderQuotaSnapshot = {
  providers: ProviderQuotaEntry[];
  /** ISO-8601 instant the snapshot itself was assembled. */
  fetchedAt: string;
};

const MAX_LABEL_LENGTH = 64;
const MAX_WINDOWS = 8;
const MAX_PROVIDERS = 24;

const KNOWN_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'Claude',
  'openai-codex': 'Codex',
  'openai-codex-device': 'Codex',
  opencodex: 'Codex',
  'github-copilot': 'Copilot',
  google: 'Gemini',
  'google-antigravity': 'Antigravity',
  'grok-build': 'Grok',
  'kimi-code': 'Kimi',
  'minimax-code': 'MiniMax',
  xai: 'xAI',
  zai: 'Z.ai',
};

/** Short, stable display label for a runtime provider id. */
export function providerQuotaDisplayName(provider: string): string {
  const known = KNOWN_PROVIDER_NAMES[provider];
  if (known) return known;
  const words = provider.split(/[-_.]+/u).filter(Boolean);
  if (words.length === 0) return provider.slice(0, MAX_LABEL_LENGTH);
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .slice(0, MAX_LABEL_LENGTH);
}

/**
 * Clamps a provider-supplied percentage into the renderable 0-100 range.
 * A non-finite value is not a zero quota: it is no observation at all.
 */
export function clampQuotaPercent(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}

/**
 * The window a compact indicator must represent: the one with the lowest
 * remaining share, because that is the limit the person hits first. Windows
 * without a percentage cannot represent the ring and are skipped.
 */
export function representativeQuotaWindow(
  windows: readonly ProviderQuotaWindow[] | undefined,
): ProviderQuotaWindow | undefined {
  let lowest: ProviderQuotaWindow | undefined;
  for (const window of windows ?? []) {
    const percent = clampQuotaPercent(window.remainingPercent);
    if (percent === undefined) continue;
    const currentLowest = lowest === undefined ? undefined : clampQuotaPercent(lowest.remainingPercent);
    if (currentLowest === undefined || percent < currentLowest) lowest = window;
  }
  return lowest;
}

/**
 * Ring value for one provider. Only `ok` carries a quota proportion:
 * `unsupported`, `reauth` and `error` must never be rendered as a low quota.
 */
export function representativeRemainingPercent(entry: ProviderQuotaEntry): number | undefined {
  if (entry.status !== 'ok') return undefined;
  return clampQuotaPercent(representativeQuotaWindow(entry.windows)?.remainingPercent);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readLabel = (value: unknown, maxLength = MAX_LABEL_LENGTH): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength ? value : undefined;

const readFinite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readIsoInstant = (value: unknown): string | undefined => {
  const text = readLabel(value, 40);
  if (!text) return undefined;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
};

function parseWindow(value: unknown): ProviderQuotaWindow | null {
  if (!isRecord(value)) return null;
  const id = readLabel(value.id);
  const label = readLabel(value.label);
  if (!id || !label) return null;
  const remainingPercent = clampQuotaPercent(value.remainingPercent);
  const used = readFinite(value.used);
  const limit = readFinite(value.limit);
  const unit = readLabel(value.unit, 16);
  const resetAt = readIsoInstant(value.resetAt);
  return {
    id,
    label,
    ...(remainingPercent === undefined ? {} : { remainingPercent }),
    ...(used === undefined ? {} : { used }),
    ...(limit === undefined ? {} : { limit }),
    ...(unit === undefined ? {} : { unit }),
    ...(resetAt === undefined ? {} : { resetAt }),
  };
}

function parseEntry(value: unknown): ProviderQuotaEntry | null {
  if (!isRecord(value)) return null;
  const provider = readLabel(value.provider, 128);
  const status = value.status;
  if (!provider || typeof status !== 'string') return null;
  if (!(PROVIDER_QUOTA_STATUSES as readonly string[]).includes(status)) return null;
  const reason = typeof value.reason === 'string' && (PROVIDER_QUOTA_REASONS as readonly string[]).includes(value.reason)
    ? value.reason as ProviderQuotaReason
    : undefined;
  const windows = (Array.isArray(value.windows) ? value.windows : [])
    .map(parseWindow)
    .filter((window): window is ProviderQuotaWindow => window !== null)
    .slice(0, MAX_WINDOWS);
  const accounts = readFinite(value.accounts);
  return {
    provider,
    providerName: readLabel(value.providerName) ?? providerQuotaDisplayName(provider),
    ...(readLabel(value.plan, 40) === undefined ? {} : { plan: readLabel(value.plan, 40)! }),
    accounts: accounts === undefined ? 1 : Math.max(0, Math.trunc(accounts)),
    windows,
    status: status as ProviderQuotaStatus,
    ...(reason === undefined ? {} : { reason }),
    stale: value.stale === true,
    fetchedAt: readIsoInstant(value.fetchedAt) ?? new Date(0).toISOString(),
  };
}

/**
 * Defensively reads a snapshot off the wire. An unusable payload degrades to
 * `null` so the indicator row simply does not render, never to a fabricated
 * quota.
 */
export function parseProviderQuotaSnapshot(value: unknown): ProviderQuotaSnapshot | null {
  const record = isRecord(value) ? value : null;
  if (!record || !Array.isArray(record.providers)) return null;
  const seen = new Set<string>();
  const providers: ProviderQuotaEntry[] = [];
  for (const candidate of record.providers) {
    const entry = parseEntry(candidate);
    if (!entry || seen.has(entry.provider)) continue;
    seen.add(entry.provider);
    providers.push(entry);
    if (providers.length >= MAX_PROVIDERS) break;
  }
  return { providers, fetchedAt: readIsoInstant(record.fetchedAt) ?? new Date(0).toISOString() };
}
