/**
 * Presentation rules for the sidebar quota indicator: which window the ring
 * represents, which states are deliberately value-less, and that a hostile or
 * degraded wire payload degrades to "render nothing" rather than to an invented
 * quota.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseProviderQuotaSnapshot,
  providerQuotaDisplayName,
  representativeRemainingPercent,
  type ProviderQuotaEntry,
  type ProviderQuotaStatus,
} from '../../../../shared/providerQuota';

import {
  quotaProviderLogoId,
  quotaResetCountdown,
  quotaRingPercent,
  quotaWindowViews,
} from './providerQuotaFormat';

const NOW = Date.UTC(2026, 0, 2, 12, 0, 0);
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function entry(overrides: Partial<ProviderQuotaEntry> = {}): ProviderQuotaEntry {
  return {
    provider: 'anthropic',
    providerName: 'Claude',
    accounts: 1,
    windows: [
      { id: '5h', label: '5 hour', remainingPercent: 72, resetAt: iso(2 * 3_600_000 + 14 * 60_000) },
      { id: '7d', label: 'Weekly', remainingPercent: 41, resetAt: iso(50 * 3_600_000) },
    ],
    status: 'ok',
    stale: false,
    fetchedAt: iso(0),
    ...overrides,
  };
}

test('the ring draws the lowest remaining window', () => {
  assert.equal(quotaRingPercent(entry()), 41);
});

test('the detail view keeps every window with its own countdown', () => {
  const views = quotaWindowViews(entry(), NOW);

  assert.deepEqual(views.map((view) => view.label), ['5 hour', 'Weekly']);
  assert.deepEqual(views.map((view) => view.remainingPercent), [72, 41]);
  assert.deepEqual(views.map((view) => view.resetsIn), ['2h 14m', '2d 2h']);
});

test('the tooltip stays bounded while retaining a later limiting window', () => {
  const windows = Array.from({ length: 9 }, (_, index) => ({
    id: `bucket-${index}`,
    label: `Bucket ${index + 1}`,
    remainingPercent: index === 8 ? 0 : 100,
  }));
  const views = quotaWindowViews(entry({ windows }), NOW);

  assert.equal(views.length, 8);
  assert.deepEqual(views.map((view) => view.label), [
    'Bucket 1',
    'Bucket 2',
    'Bucket 3',
    'Bucket 4',
    'Bucket 5',
    'Bucket 6',
    'Bucket 7',
    'Bucket 9',
  ]);
  assert.equal(quotaRingPercent(entry({ windows })), 0);
});

test('non-ok states carry no ring value', () => {
  for (const status of ['unsupported', 'reauth', 'error'] satisfies ProviderQuotaStatus[]) {
    const candidate = entry({ status });
    assert.equal(quotaRingPercent(candidate), undefined, `${status} must not render as a quota`);
    assert.equal(representativeRemainingPercent(candidate), undefined);
  }
});

test('a window without a proportion shows its counts instead of a fabricated percentage', () => {
  const views = quotaWindowViews(
    entry({ windows: [{ id: 'tokens', label: 'Tokens', used: 12_500, limit: 50_000, unit: 'tokens' }] }),
    NOW,
  );

  assert.equal(views[0]?.remainingPercent, undefined);
  assert.equal(views[0]?.amount, '12.5K / 50K tokens');
});

test('an elapsed reset produces no countdown', () => {
  assert.equal(quotaResetCountdown(iso(-60_000), NOW), undefined);
  assert.equal(quotaResetCountdown(undefined, NOW), undefined);
  assert.equal(quotaResetCountdown('not-a-date', NOW), undefined);
});

test('countdowns keep two units so six and seven days do not read alike', () => {
  assert.equal(quotaResetCountdown(iso(30_000), NOW), '<1m');
  assert.equal(quotaResetCountdown(iso(35 * 60_000), NOW), '35m');
  assert.equal(quotaResetCountdown(iso(3 * 3_600_000), NOW), '3h');
  assert.equal(quotaResetCountdown(iso(6.6 * 24 * 3_600_000), NOW), '6d 14h');
  assert.equal(quotaResetCountdown(iso(7.4 * 24 * 3_600_000), NOW), '7d 9h');
});

test('only providers the app owns a mark for get a logo', () => {
  assert.equal(quotaProviderLogoId('anthropic'), 'claude');
  assert.equal(quotaProviderLogoId('openai-codex'), 'codex');
  assert.equal(quotaProviderLogoId('zai'), null, 'an unmapped provider must not borrow another brand');
});

test('runtime provider ids get a short display label', () => {
  assert.equal(providerQuotaDisplayName('anthropic'), 'Claude');
  assert.equal(providerQuotaDisplayName('openai-codex'), 'Codex');
  assert.equal(providerQuotaDisplayName('some-new-provider'), 'Some New Provider');
});

test('a wire percentage outside 0-100 is clamped before it can be drawn', () => {
  const snapshot = parseProviderQuotaSnapshot({
    providers: [{
      provider: 'anthropic',
      providerName: 'Claude',
      status: 'ok',
      accounts: 1,
      stale: false,
      fetchedAt: iso(0),
      windows: [
        { id: 'over', label: 'Over', remainingPercent: 420 },
        { id: 'under', label: 'Under', remainingPercent: -12 },
      ],
    }],
    fetchedAt: iso(0),
  });

  assert.deepEqual(snapshot?.providers[0]?.windows.map((window) => window.remainingPercent), [100, 0]);
  assert.equal(representativeRemainingPercent(snapshot!.providers[0]!), 0);
});

test('an unusable payload becomes no snapshot rather than a fabricated one', () => {
  assert.equal(parseProviderQuotaSnapshot(null), null);
  assert.equal(parseProviderQuotaSnapshot({ error: 'Unauthorized' }), null);
  assert.deepEqual(parseProviderQuotaSnapshot({ providers: 'nope' }), null);
});

test('unreadable and duplicate provider entries are dropped, not guessed at', () => {
  const snapshot = parseProviderQuotaSnapshot({
    providers: [
      { provider: 'anthropic', status: 'ok', windows: [], fetchedAt: iso(0) },
      { provider: 'anthropic', status: 'ok', windows: [], fetchedAt: iso(0) },
      { provider: 'broken', status: 'not-a-status', windows: [] },
      { status: 'ok', windows: [] },
    ],
    fetchedAt: iso(0),
  });

  assert.deepEqual(snapshot?.providers.map((provider) => provider.provider), ['anthropic']);
});

test('an unknown reason code from the wire is discarded', () => {
  const snapshot = parseProviderQuotaSnapshot({
    providers: [{ provider: 'anthropic', status: 'error', reason: '401 Bearer sk-ant-secret', windows: [], fetchedAt: iso(0) }],
    fetchedAt: iso(0),
  });

  assert.equal(snapshot?.providers[0]?.reason, undefined);
});
