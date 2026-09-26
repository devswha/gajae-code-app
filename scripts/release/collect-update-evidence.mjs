#!/usr/bin/env node
// Read-only operator evidence, never an install/restart/recovery authority.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import semver from 'semver';

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const version = value => typeof value === 'string' && value.length <= 128 && semver.valid(value) === value;
const code = value => typeof value === 'string' && /^[a-z][a-z_-]{0,63}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
// The owner census reports one of its fixed lowercase sentences; anything else is dropped.
const detail = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9 ,./-]{0,127}$/.test(value) && !/[/.][^ ]*[/.]/.test(value);
// A backend refusal names its owners; keep only bounded identifier pairs.
const blockers = value => Array.isArray(value) && value.length > 0 && value.length <= 32
  && value.every(item => record(item) && Object.keys(item).length === 2
    && (item.owner === null || identifier(item.owner)) && identifier(item.code))
  ? value.map(({ owner, code }) => ({ owner, code })) : undefined;

async function readBounded(root, name, limit) {
  let file;
  try { file = await open(path.join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error(`Cannot safely read ${name}.`); }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw new Error(`Invalid ${name}.`);
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error(`Oversized ${name}.`);
    return buffer.subarray(0, length).toString('utf8');
  } finally { await file.close(); }
}

export function summarizeUpdateEvidence({ diagnostics, completion, pending }, expected = {}) {
  const stages = [];
  for (const line of (diagnostics ?? '').split('\n').filter(Boolean)) {
    let value;
    try { value = JSON.parse(line); } catch { continue; }
    if (!record(value) || value.event !== 'desktop_update_restart' || !digest(value.attemptId)
      || !code(value.stage) || !integer(value.elapsedMs)) continue;
    stages.push({ attemptId: value.attemptId, stage: value.stage, elapsedMs: value.elapsedMs,
      ...(code(value.reason) ? { reason: value.reason } : {}),
      ...(blockers(value.blockers) ? { blockers: blockers(value.blockers) } : {}),
      ...(detail(value.detail) ? { detail: value.detail } : {}),
      ...(integer(value.timeMs) ? { timeMs: value.timeMs } : {}) });
  }
  let receipt;
  try { receipt = completion === null ? null : JSON.parse(completion); }
  catch { throw new Error('Invalid completion JSON.'); }
  let observedCompletion = null;
  if (receipt !== null && receipt !== undefined) {
    const target = receipt?.attempt?.target;
    if (!record(receipt) || !record(target)) throw new Error('Invalid completion record.');
    if (receipt.schema === 2 && receipt.state === 'committed' && receipt.attempt.phase === 'awaiting_health'
      && version(target.source_desktop_version) && version(target.target_desktop_version)
      && version(target.target_product_version) && semver.gt(target.target_desktop_version, target.source_desktop_version) && digest(target.archive_sha256)) {
      observedCompletion = { from: target.source_desktop_version, to: target.target_desktop_version,
        product: target.target_product_version, archiveSha256: target.archive_sha256 };
    }
  }
  const expectedMatch = observedCompletion !== null && !pending
    && Object.entries(expected).every(([key, value]) => observedCompletion[key] === value);
  return { schemaVersion: 1, status: pending ? 'pending-installation' : expectedMatch ? 'completion-record-matches' : 'no-matching-completion',
    observedCompletion, stages: stages.slice(-64),
    // A serialized receipt does not prove current PID identity, health, signatures or data survival.
    liveInstallationVerified: false };
}

export async function collectUpdateEvidence(root, expected) {
  if (!path.isAbsolute(root)) throw new Error('An absolute data root is required.');
  const [diagnostics, completion, attempt, staged] = await Promise.all([
    readBounded(root, 'updater-restart.jsonl', 64 * 1024),
    readBounded(root, 'desktop-update-completed.json', 16 * 1024),
    readBounded(root, 'desktop-update-attempt.json', 16 * 1024),
    readBounded(root, 'desktop-update-completed.next.json', 16 * 1024),
  ]);
  return summarizeUpdateEvidence({ diagnostics, completion, pending: attempt !== null || staged !== null }, expected);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 8 || args[0] !== '--data-root' || args[2] !== '--from' || args[4] !== '--to' || args[6] !== '--product'
      || !args.slice(3).filter((_, i) => i % 2 === 0).every(version)) {
      throw new Error('Usage: collect-update-evidence.mjs --data-root ABSOLUTE_ROOT --from DESKTOP_A --to DESKTOP_B --product PRODUCT_B');
    }
    const result = await collectUpdateEvidence(args[1], { from: args[3], to: args[5], product: args[7] });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'completion-record-matches') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
