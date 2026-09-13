/**
 * The sidebar quota indicator and `/usage` must read the same structured
 * source, so these tests pin the projection from the runtime's account
 * inventory / `UsageReport` shapes onto the renderer DTO: which window a
 * compact ring represents, which states are not a quota at all, and that one
 * failing provider cannot blank its peers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProviderQuotaSnapshot, representativeRemainingPercent, type ProviderQuotaSnapshot } from '../shared/providerQuota.js';

import {
  buildProviderQuotaSnapshot,
  normalizeQuotaWindows,
  type ProviderQuotaInventoryRow,
  type ProviderUsageReportLike,
} from './gjc-provider-quota.js';

const NOW = Date.UTC(2026, 0, 2, 12, 0, 0);

function limit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'anthropic:5h',
    label: '5 hour',
    scope: { provider: 'anthropic' },
    window: { id: '5h', label: '5 hour', durationMs: 5 * 3_600_000, resetsAt: NOW + 2 * 3_600_000 },
    amount: { usedFraction: 0.28, unit: 'percent' },
    ...overrides,
  };
}

function report(provider: string, limits: Array<Record<string, unknown>>, metadata?: Record<string, unknown>): ProviderUsageReportLike {
  return { provider, fetchedAt: NOW, limits, ...(metadata ? { metadata } : {}) };
}

function row(overrides: Partial<ProviderQuotaInventoryRow> = {}): ProviderQuotaInventoryRow {
  return {
    provider: 'anthropic',
    disabled: false,
    disabledCause: null,
    health: { status: 'unknown', reason: null },
    ...overrides,
  };
}

const build = (
  rows: ProviderQuotaInventoryRow[],
  fetchProviderUsage: (provider: string) => Promise<readonly ProviderUsageReportLike[] | null>,
) => buildProviderQuotaSnapshot({ rows, fetchProviderUsage, now: NOW });

const entryFor = (snapshot: ProviderQuotaSnapshot, provider: string) =>
  snapshot.providers.find((entry) => entry.provider === provider);

test('the representative ring value is the window with the least remaining', async () => {
  const snapshot = await build(
    [row()],
    async () => [report('anthropic', [
      limit({ id: 'anthropic:5h', label: '5 hour', amount: { remainingFraction: 0.72, unit: 'percent' } }),
      limit({ id: 'anthropic:7d', label: 'Weekly', window: { id: '7d', label: 'Weekly' }, amount: { remainingFraction: 0.41, unit: 'percent' } }),
    ])],
  );

  const entry = entryFor(snapshot, 'anthropic')!;
  assert.equal(entry.status, 'ok');
  assert.deepEqual(entry.windows.map((window) => window.label), ['5 hour', 'Weekly']);
  assert.equal(representativeRemainingPercent(entry), 41, 'the ring must show the limit that runs out first');
});

test('every window stays independently addressable for the detail view', async () => {
  const snapshot = await build(
    [row()],
    async () => [report('anthropic', [
      limit({ id: 'anthropic:5h', amount: { remainingFraction: 0.72, unit: 'percent' } }),
      limit({
        id: 'anthropic:7d',
        label: 'Weekly',
        window: { id: '7d', label: 'Weekly', resetsAt: NOW + 26 * 3_600_000 },
        amount: { remainingFraction: 0.41, unit: 'percent' },
      }),
    ])],
  );

  const windows = entryFor(snapshot, 'anthropic')!.windows;
  assert.equal(windows.length, 2);
  assert.equal(windows[0]?.remainingPercent, 72);
  assert.equal(windows[0]?.resetAt, new Date(NOW + 2 * 3_600_000).toISOString());
  assert.equal(windows[1]?.remainingPercent, 41);
  assert.equal(windows[1]?.resetAt, new Date(NOW + 26 * 3_600_000).toISOString());
});

test('a later exhausted window survives the bounded detail projection', async () => {
  const limits = Array.from({ length: 9 }, (_, index) => limit({
    id: `anthropic:bucket-${index}`,
    label: `Bucket ${index + 1}`,
    window: { id: `${index + 1}h`, label: `${index + 1} hour` },
    amount: { remainingFraction: index === 8 ? 0 : 1, unit: 'percent' },
  }));

  const snapshot = await build([row()], async () => [report('anthropic', limits)]);
  const entry = entryFor(snapshot, 'anthropic')!;

  assert.equal(entry.windows.length, 8, 'the detail DTO remains bounded');
  assert.deepEqual(
    entry.windows.map((window) => window.id),
    [
      'anthropic:bucket-0',
      'anthropic:bucket-1',
      'anthropic:bucket-2',
      'anthropic:bucket-3',
      'anthropic:bucket-4',
      'anthropic:bucket-5',
      'anthropic:bucket-6',
      'anthropic:bucket-8',
    ],
    'the first seven entries stay in order and the limiting tail entry fills the final slot',
  );
  assert.equal(representativeRemainingPercent(entry), 0, 'the ring must see the exhausted ninth limit');
});

test('distinct limits sharing a duration keep their identity and useful labels', async () => {
  const snapshot = await build(
    [row({ provider: 'google-antigravity' })],
    async () => [report('google-antigravity', [
      limit({
        id: 'gemini-pro:default:5h',
        label: 'Gemini Pro',
        window: { id: '5h', label: '5 hour' },
        amount: { remainingFraction: 0.9, unit: 'percent' },
      }),
      limit({
        id: 'gemini-flash:default:5h',
        label: 'Gemini Flash',
        window: { id: '5h', label: '5 hour' },
        amount: { remainingFraction: 0.05, unit: 'percent' },
      }),
    ])],
  );

  const entry = entryFor(snapshot, 'google-antigravity')!;
  assert.deepEqual(entry.windows.map((window) => window.id), ['gemini-pro:default:5h', 'gemini-flash:default:5h']);
  assert.deepEqual(entry.windows.map((window) => window.label), ['Gemini Pro', 'Gemini Flash']);
  assert.equal(representativeRemainingPercent(entry), 5, 'the tighter model limit must drive the ring');
});

test('unsafe limit ids use unique fallbacks instead of collapsing shared windows', () => {
  const windows = normalizeQuotaWindows(report('anthropic', [
    limit({
      id: 'a'.repeat(65),
      label: 'First model',
      window: { id: '5h', label: '5 hour' },
      amount: { remainingFraction: 0.8, unit: 'percent' },
    }),
    limit({
      id: 'b'.repeat(65),
      label: 'Second model',
      window: { id: '5h', label: '5 hour' },
      amount: { remainingFraction: 0.1, unit: 'percent' },
    }),
  ]));

  assert.deepEqual(windows.map((window) => window.id), ['window-0', 'window-1']);
  assert.deepEqual(windows.map((window) => window.label), ['First model', 'Second model']);
  assert.equal(representativeRemainingPercent({
    provider: 'anthropic',
    providerName: 'Claude',
    accounts: 1,
    windows,
    status: 'ok',
    stale: false,
    fetchedAt: new Date(NOW).toISOString(),
  }), 10);
});

test('out-of-range provider percentages are clamped into 0-100', () => {
  const windows = normalizeQuotaWindows(report('anthropic', [
    limit({ id: 'over', window: { id: 'over', label: 'Over' }, amount: { remainingFraction: 1.4, unit: 'percent' } }),
    limit({ id: 'under', window: { id: 'under', label: 'Under' }, amount: { remainingFraction: -0.3, unit: 'percent' } }),
    limit({ id: 'overused', window: { id: 'overused', label: 'Overused' }, amount: { usedFraction: 1.8, unit: 'percent' } }),
  ]));

  assert.deepEqual(windows.map((window) => window.remainingPercent), [100, 0, 0]);
});

test('a non-finite percentage is no observation rather than a zero quota', () => {
  const windows = normalizeQuotaWindows(report('anthropic', [
    limit({ id: 'broken', window: { id: 'broken', label: 'Broken' }, amount: { remainingFraction: Number.NaN, unit: 'percent' } }),
  ]));

  assert.equal(windows[0]?.remainingPercent, undefined);
});

test('counted quotas derive a percentage from used against limit', () => {
  const windows = normalizeQuotaWindows(report('zai', [
    limit({ id: 'monthly', window: { id: 'monthly', label: 'Monthly' }, amount: { used: 250, limit: 1_000, unit: 'requests' } }),
  ]));

  assert.equal(windows[0]?.remainingPercent, 75);
  assert.equal(windows[0]?.used, 250);
  assert.equal(windows[0]?.limit, 1_000);
  assert.equal(windows[0]?.unit, 'requests');
});

test('a connected provider with no usage endpoint is unsupported, not empty quota', async () => {
  const snapshot = await build([row({ provider: 'cursor' })], async () => []);

  const entry = entryFor(snapshot, 'cursor')!;
  assert.equal(entry.status, 'unsupported');
  assert.equal(entry.reason, 'usage_unsupported');
  assert.deepEqual(entry.windows, []);
  assert.equal(representativeRemainingPercent(entry), undefined, 'unsupported must not read as a quota value');
});

test('a provider that reports windows without any proportion is unsupported', async () => {
  const snapshot = await build(
    [row({ provider: 'kimi-code' })],
    async () => [report('kimi-code', [limit({ id: 'tokens', window: { id: 'tokens', label: 'Tokens' }, amount: { used: 12_000, unit: 'tokens' } })])],
  );

  const entry = entryFor(snapshot, 'kimi-code')!;
  assert.equal(entry.status, 'unsupported');
  assert.equal(entry.reason, 'no_usage_data');
  assert.equal(representativeRemainingPercent(entry), undefined);
  assert.equal(entry.windows[0]?.used, 12_000, 'the detail view still shows what was reported');
});

test('a provider whose only credentials failed auth reports reauth without fetching', async () => {
  let fetched = 0;
  const snapshot = await build(
    [row({ disabled: true, disabledCause: 'auth_failure' })],
    async () => { fetched += 1; return []; },
  );

  const entry = entryFor(snapshot, 'anthropic')!;
  assert.equal(entry.status, 'reauth');
  assert.equal(entry.reason, 'reauth_required');
  assert.equal(fetched, 0, 'a credential that needs re-auth must not be probed');
  assert.equal(representativeRemainingPercent(entry), undefined, 'reauth must not read as a low quota');
});

test('an active credential whose health check failed reports reauth, not a quota', async () => {
  const snapshot = await build(
    [row({ health: { status: 'failed', reason: 'unauthorized' } })],
    async () => [report('anthropic', [limit({ amount: { remainingFraction: 0.9, unit: 'percent' } })])],
  );

  const entry = entryFor(snapshot, 'anthropic')!;
  assert.equal(entry.status, 'reauth');
  assert.equal(representativeRemainingPercent(entry), undefined);
});

test('a credential removed by the user is not a connected provider', async () => {
  const snapshot = await build([row({ disabled: true, disabledCause: 'user_removed' })], async () => []);

  assert.deepEqual(snapshot.providers, [], 'a removed account must not leave an indicator behind');
});

test('one failing provider does not suppress the others', async () => {
  const snapshot = await build(
    [row({ provider: 'anthropic' }), row({ provider: 'openai-codex' })],
    async (provider) => {
      if (provider === 'anthropic') throw new Error('usage endpoint returned 500 for account jane@example.com');
      return [report('openai-codex', [limit({ id: 'openai-codex:primary', window: { id: '5h', label: '5 hour' }, amount: { remainingFraction: 0.63, unit: 'percent' } })])];
    },
  );

  assert.equal(snapshot.providers.length, 2);
  const failed = entryFor(snapshot, 'anthropic')!;
  const healthy = entryFor(snapshot, 'openai-codex')!;
  assert.equal(failed.status, 'error');
  assert.equal(failed.reason, 'fetch_failed');
  assert.equal(representativeRemainingPercent(failed), undefined);
  assert.equal(healthy.status, 'ok');
  assert.equal(representativeRemainingPercent(healthy), 63);
});

test('a failed refresh never leaks the provider error text', async () => {
  const snapshot = await build(
    [row()],
    async () => { throw new Error('401 Bearer sk-ant-secret rejected for jane@example.com'); },
  );

  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('sk-ant-secret'), false);
  assert.equal(serialized.includes('jane@example.com'), false);
  assert.equal(entryFor(snapshot, 'anthropic')!.reason, 'fetch_failed');
});

test('a failed refresh still exposes the last known windows as stale detail', async () => {
  const snapshot = await build(
    [row({
      usage: {
        report: report('anthropic', [limit({ amount: { remainingFraction: 0.55, unit: 'percent' } })]),
        fetchedAt: NOW - 20 * 60_000,
        freshness: 'stale-last-good',
      },
    })],
    async () => { throw new Error('network unreachable'); },
  );

  const entry = entryFor(snapshot, 'anthropic')!;
  assert.equal(entry.status, 'error');
  assert.equal(entry.stale, true);
  assert.equal(entry.windows[0]?.remainingPercent, 55);
  assert.equal(representativeRemainingPercent(entry), undefined, 'a stale reading is detail, never the ring value');
});

test('the cached inventory report is used when a refresh returns nothing', async () => {
  const snapshot = await build(
    [row({
      usage: {
        report: report('anthropic', [limit({ amount: { remainingFraction: 0.33, unit: 'percent' } })]),
        fetchedAt: NOW - 30_000,
        freshness: 'fresh',
      },
    })],
    async () => null,
  );

  const entry = entryFor(snapshot, 'anthropic')!;
  assert.equal(entry.status, 'ok');
  assert.equal(entry.stale, false);
  assert.equal(representativeRemainingPercent(entry), 33);
});

test('a provider with several accounts is represented by the one with most headroom', async () => {
  const snapshot = await build(
    [row(), row()],
    async () => [
      report('anthropic', [limit({ amount: { remainingFraction: 0.12, unit: 'percent' } })]),
      report('anthropic', [limit({ amount: { remainingFraction: 0.81, unit: 'percent' } })]),
    ],
  );

  const entry = entryFor(snapshot, 'anthropic')!;
  assert.equal(representativeRemainingPercent(entry), 81, 'the runtime would route to the account with headroom');
  assert.equal(entry.accounts, 2);
});

test('account selection sees a limiting window beyond the detail bound', async () => {
  const limitsFor = (tailRemaining: number, label: string) => Array.from({ length: 9 }, (_, index) => limit({
    id: `anthropic:${label}-${index}`,
    label: `${label} ${index + 1}`,
    window: { id: `${label}-${index}`, label: `${label} ${index + 1}` },
    amount: { remainingFraction: index === 8 ? tailRemaining : 1, unit: 'percent' },
  }));

  const snapshot = await build(
    [row(), row()],
    async () => [
      report('anthropic', limitsFor(0, 'exhausted')),
      report('anthropic', limitsFor(0.2, 'headroom')),
    ],
  );

  const entry = entryFor(snapshot, 'anthropic')!;
  assert.equal(entry.accounts, 2);
  assert.equal(entry.windows.at(-1)?.label, 'headroom 9', 'the account with actual headroom is selected');
  assert.equal(representativeRemainingPercent(entry), 20);
});

test('the bounded wire DTO round-trips its limiting window', async () => {
  const limits = Array.from({ length: 9 }, (_, index) => limit({
    id: `anthropic:wire-${index}`,
    label: `Wire ${index + 1}`,
    window: { id: `wire-${index}`, label: `Wire ${index + 1}` },
    amount: { remainingFraction: index === 8 ? 0 : 1, unit: 'percent' },
  }));
  const snapshot = await build([row()], async () => [report('anthropic', limits)]);
  const parsed = parseProviderQuotaSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const entry = parsed?.providers[0];

  assert.ok(entry);
  assert.equal(entry.windows.length, 8);
  assert.equal(entry.windows.at(-1)?.id, 'anthropic:wire-8');
  assert.equal(representativeRemainingPercent(entry), 0);
});

test('an observation older than the runtime fresh window is marked stale', async () => {
  const snapshot = await build(
    [row()],
    async () => [{ ...report('anthropic', [limit({ amount: { remainingFraction: 0.5, unit: 'percent' } })]), fetchedAt: NOW - 9 * 60_000 }],
  );

  assert.equal(entryFor(snapshot, 'anthropic')!.stale, true);
});

test('the plan label is carried through only when it is a safe token', async () => {
  const safe = await build(
    [row()],
    async () => [report('anthropic', [limit({ amount: { remainingFraction: 0.5, unit: 'percent' } })], { planType: 'max_20x' })],
  );
  assert.equal(entryFor(safe, 'anthropic')!.plan, 'max_20x');

  const hostile = await build(
    [row()],
    async () => [report('anthropic', [limit({ amount: { remainingFraction: 0.5, unit: 'percent' } })], { planType: 'Bearer sk-ant-oat01-secret' })],
  );
  assert.equal(entryFor(hostile, 'anthropic')!.plan, undefined);
});

test('providers that can draw an arc come first, then re-auth, error and quota-less', async () => {
  const snapshot = await build(
    [
      row({ provider: 'zai' }),
      row({ provider: 'openai-codex' }),
      row({ provider: 'perplexity' }),
      row({ provider: 'anthropic' }),
      row({ provider: 'kimi-code', health: { status: 'failed', reason: 'unauthorized' } }),
    ],
    async (provider) => {
      if (provider === 'perplexity') throw new Error('unreachable');
      if (provider === 'zai') return [];
      return [report(provider, [limit({ amount: { remainingFraction: 0.5, unit: 'percent' } })])];
    },
  );

  assert.deepEqual(
    snapshot.providers.map((entry) => [entry.provider, entry.status]),
    [
      ['anthropic', 'ok'],
      ['openai-codex', 'ok'],
      ['kimi-code', 'reauth'],
      ['perplexity', 'error'],
      ['zai', 'unsupported'],
    ],
    'quota-less providers must not bury the ones with an actual reading',
  );
});

test('no connected provider produces no entries at all', async () => {
  const snapshot = await buildProviderQuotaSnapshot({ rows: [], fetchProviderUsage: async () => [], now: NOW });
  assert.deepEqual(snapshot.providers, []);
  assert.equal(snapshot.fetchedAt, new Date(NOW).toISOString());
});
