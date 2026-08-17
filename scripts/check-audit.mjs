#!/usr/bin/env node

/**
 * Fails the build on any high or critical npm advisory that is not a recorded,
 * still-valid exception.
 *
 * `npm audit --audit-level=high` cannot express "this one has no patched
 * release anywhere". Without a place to record that, the gate is either red
 * forever or turned off entirely, and the second one hides the next real
 * advisory. Every exception below therefore carries the reason no fix exists
 * and a review date: an expired exception fails, and so does one that no longer
 * matches a live advisory, so the list cannot quietly rot.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const ADVISORY_PATTERN = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/iu;

const EXCEPTIONS = [
  {
    advisory: 'GHSA-jmr9-qjv8-65gv',
    package: 'extract-zip',
    reviewBy: '2026-11-30',
    reason:
      'extract-zip has no patched release. It reaches us through '
      + '@gajae-code/coding-agent -> puppeteer-core 24.x -> @puppeteer/browsers 2.x, '
      + 'and @puppeteer/browsers only dropped extract-zip in 3.x, which needs '
      + 'puppeteer-core 25. Nothing downstream of the SDK can resolve it. The app '
      + 'never unpacks an attacker-supplied archive with it: the only caller is the '
      + 'browser download puppeteer performs against its pinned Chromium URL.',
  },
];

function advisoryIdOf(via) {
  if (typeof via === 'string') return null;
  const source = via.url ?? via.title ?? '';
  return ADVISORY_PATTERN.exec(source)?.[0]?.toUpperCase() ?? null;
}

async function auditReport() {
  try {
    const { stdout } = await execFile('npm', ['audit', '--json'], {
      cwd: REPOSITORY_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    // npm exits non-zero whenever it reports a vulnerability, and still writes
    // the report to stdout. Only a missing report is a real failure.
    if (typeof error.stdout === 'string' && error.stdout.trim().length > 0) {
      return JSON.parse(error.stdout);
    }
    throw new Error(`npm audit did not produce a report: ${error.message}`);
  }
}

const report = await auditReport();
const vulnerabilities = Object.values(report.vulnerabilities ?? {});
const blocking = new Map();

for (const vulnerability of vulnerabilities) {
  if (!BLOCKING_SEVERITIES.has(vulnerability.severity)) continue;
  for (const via of vulnerability.via ?? []) {
    const advisory = advisoryIdOf(via);
    // A string `via` is a dependency path onto another package's advisory; the
    // advisory itself is reported on the package that actually carries it.
    if (!advisory) continue;
    if (!blocking.has(advisory)) {
      blocking.set(advisory, { advisory, package: via.name ?? vulnerability.name, severity: via.severity ?? vulnerability.severity, title: via.title ?? '' });
    }
  }
}

const today = new Date().toISOString().slice(0, 10);
const errors = [];
const honored = [];

for (const exception of EXCEPTIONS) {
  const advisory = exception.advisory.toUpperCase();
  const live = blocking.get(advisory);
  if (!live) {
    errors.push(
      `Exception for ${advisory} (${exception.package}) no longer matches any high or critical advisory. `
      + 'Remove it from scripts/check-audit.mjs.',
    );
    continue;
  }
  blocking.delete(advisory);
  if (exception.reviewBy < today) {
    errors.push(
      `Exception for ${advisory} (${exception.package}) expired on ${exception.reviewBy}. `
      + 'Re-check for an upstream fix, then either resolve it or extend the review date with a fresh reason.',
    );
    continue;
  }
  honored.push(`${advisory} (${exception.package}, review by ${exception.reviewBy})`);
}

for (const live of blocking.values()) {
  errors.push(`${live.severity} advisory ${live.advisory} in ${live.package}: ${live.title}`);
}

if (errors.length > 0) {
  console.error('Dependency audit failed:');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('\nRun `npm audit` for the full report, or `npm audit fix` for the advisories that have a patched release.');
  process.exit(1);
}

const counts = report.metadata?.vulnerabilities ?? {};
const belowGate = Object.entries(counts)
  .filter(([severity, count]) => !BLOCKING_SEVERITIES.has(severity) && severity !== 'total' && count > 0)
  .map(([severity, count]) => `${count} ${severity}`)
  .join(', ');
console.log(`Dependency audit passed (no unexpected high or critical advisories${belowGate ? `; below the gate: ${belowGate}` : ''}).`);
for (const entry of honored) console.log(`  recorded exception: ${entry}`);
