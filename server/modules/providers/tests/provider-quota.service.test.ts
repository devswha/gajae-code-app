/**
 * Transport behaviour of the quota read: it must not re-enter the worker for
 * every reader, an explicit refresh must bypass the memo, and a worker that is
 * not answering must degrade to "no rings" rather than to an error surface.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { providerQuotaService } from '@/modules/providers/services/provider-quota.service.js';
import { registerGjcRuntimeProviderQuotaLoader } from '@/shared/utils.js';

import type { ProviderQuotaSnapshot } from '../../../../shared/providerQuota.js';

const snapshot = (remainingPercent: number): ProviderQuotaSnapshot => ({
  providers: [{
    provider: 'anthropic',
    providerName: 'Claude',
    accounts: 1,
    windows: [{ id: '5h', label: '5 hour', remainingPercent }],
    status: 'ok',
    stale: false,
    fetchedAt: new Date(0).toISOString(),
  }],
  fetchedAt: new Date(0).toISOString(),
});

const remainingOf = (result: ProviderQuotaSnapshot) => result.providers[0]?.windows[0]?.remainingPercent;

afterEach(() => {
  providerQuotaService.resetProviderQuotaCache();
  registerGjcRuntimeProviderQuotaLoader(async () => ({ ok: true, result: snapshot(100) }));
});

test('concurrent readers share one worker round trip', async () => {
  let calls = 0;
  registerGjcRuntimeProviderQuotaLoader(async () => {
    calls += 1;
    await Promise.resolve();
    return { ok: true, result: snapshot(72) };
  });
  providerQuotaService.resetProviderQuotaCache();

  const results = await Promise.all([
    providerQuotaService.getProviderQuota(),
    providerQuotaService.getProviderQuota(),
    providerQuotaService.getProviderQuota(),
  ]);

  assert.equal(calls, 1, 'three tabs asking at once must not become three probes');
  assert.deepEqual(results.map(remainingOf), [72, 72, 72]);
});

test('a second read inside the memo window does not re-enter the worker', async () => {
  let calls = 0;
  registerGjcRuntimeProviderQuotaLoader(async () => {
    calls += 1;
    return { ok: true, result: snapshot(calls === 1 ? 72 : 10) };
  });
  providerQuotaService.resetProviderQuotaCache();

  assert.equal(remainingOf(await providerQuotaService.getProviderQuota()), 72);
  assert.equal(remainingOf(await providerQuotaService.getProviderQuota()), 72);
  assert.equal(calls, 1);
});

test('an explicit refresh bypasses the memo', async () => {
  let calls = 0;
  registerGjcRuntimeProviderQuotaLoader(async () => {
    calls += 1;
    return { ok: true, result: snapshot(calls === 1 ? 72 : 10) };
  });
  providerQuotaService.resetProviderQuotaCache();

  await providerQuotaService.getProviderQuota();
  assert.equal(remainingOf(await providerQuotaService.getProviderQuota({ refresh: true })), 10);
  assert.equal(calls, 2, 'connecting an account must be able to force a fresh read');
});

test('an unavailable worker degrades to an empty snapshot, not an error', async () => {
  registerGjcRuntimeProviderQuotaLoader(async () => { throw new Error('GJC worker is not running'); });
  providerQuotaService.resetProviderQuotaCache();

  const result = await providerQuotaService.getProviderQuota();

  assert.deepEqual(result.providers, [], 'an ambient indicator must not become an error banner');
});

test('a worker failure response keeps the previous reading rather than blanking it', async () => {
  registerGjcRuntimeProviderQuotaLoader(async () => ({ ok: true, result: snapshot(55) }));
  providerQuotaService.resetProviderQuotaCache();
  await providerQuotaService.getProviderQuota();

  registerGjcRuntimeProviderQuotaLoader(async () => ({ ok: false, error: { code: 'provider_quota_failed', message: 'Provider quota is unavailable.' } }));
  const result = await providerQuotaService.getProviderQuota({ refresh: true });

  assert.equal(remainingOf(result), 55);
});

test('an unusable worker payload is refused rather than surfaced', async () => {
  registerGjcRuntimeProviderQuotaLoader(async () => ({ ok: true, result: { providers: 'not-an-array' } }));
  providerQuotaService.resetProviderQuotaCache();

  assert.deepEqual((await providerQuotaService.getProviderQuota()).providers, []);
});
