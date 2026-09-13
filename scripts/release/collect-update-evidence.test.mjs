import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectUpdateEvidence, summarizeUpdateEvidence } from './collect-update-evidence.mjs';

const expected = { from: '0.2.10', to: '0.2.11', product: '2.0.0-beta.17' };
const receipt = () => ({ schema: 2, state: 'committed', attempt: { phase: 'awaiting_health',
  target: { source_desktop_version: expected.from, target_desktop_version: expected.to,
    target_product_version: expected.product, archive_sha256: 'a'.repeat(64), app_path: '/private/user/path.app' } } });
const summary = (value, pending = false) => summarizeUpdateEvidence({ completion: JSON.stringify(value), diagnostics: '', pending }, expected);

test('completion matching is explicit observation, not health or install authority', () => {
  const result = summary(receipt());
  assert.equal(result.status, 'completion-record-matches');
  assert.equal(result.liveInstallationVerified, false);
  assert.equal(JSON.stringify(result).includes('/private/user'), false);
  const mismatch = receipt(); mismatch.attempt.target.target_desktop_version = '0.2.12';
  assert.equal(summary(mismatch).status, 'no-matching-completion');
  assert.equal(summary(receipt(), true).status, 'pending-installation');
});

test('legacy and merely prepared receipts never count as committed', () => {
  for (const state of ['prepared_success', 'verified_success']) {
    assert.equal(summary({ ...receipt(), state }).status, 'no-matching-completion');
  }
  assert.equal(summary({ ...receipt(), schema: 1 }).status, 'no-matching-completion');
  assert.throws(() => summary({}), /Invalid completion/);
});

test('diagnostic export strips payload and raw errors and bounds records', () => {
  const value = { event: 'desktop_update_restart', attemptId: 'b'.repeat(64), stage: 'abort', elapsedMs: 50,
    reason: 'updater_runtime_busy', prompt: 'private prompt', url: 'secret URL' };
  const result = summarizeUpdateEvidence({ pending: false, completion: null,
    diagnostics: Array.from({ length: 100 }, () => JSON.stringify(value)).join('\n') }, expected);
  assert.equal(result.stages.length, 64);
  assert.equal(JSON.stringify(result).includes('private prompt'), false);
  assert.equal(JSON.stringify(result).includes('secret URL'), false);
  const raw = summarizeUpdateEvidence({ completion: null, pending: false,
    diagnostics: JSON.stringify({ ...value, reason: 'Bearer private-token' }) }, expected);
  assert.equal(raw.stages[0].reason, undefined);
});

test('collector leaves fixture bytes intact, rejects aliases and oversized evidence', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'gajae-update-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'desktop-update-completed.json');
  const original = JSON.stringify(receipt());
  await writeFile(file, original);
  assert.equal((await collectUpdateEvidence(root, expected)).status, 'completion-record-matches');
  assert.equal(await readFile(file, 'utf8'), original);
  const pending = path.join(root, 'desktop-update-attempt.json');
  await writeFile(pending, '{}');
  assert.equal((await collectUpdateEvidence(root, expected)).status, 'pending-installation');
  await rm(pending);
  const log = path.join(root, 'updater-restart.jsonl');
  await symlink(file, log);
  await assert.rejects(collectUpdateEvidence(root, expected), /Cannot safely read/);
  await rm(log);
  await writeFile(log, 'x'.repeat(65537));
  await assert.rejects(collectUpdateEvidence(root, expected), /Invalid/);
});
