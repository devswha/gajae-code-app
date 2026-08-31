/**
 * Fails when a package the app would ship carries terms this product cannot
 * distribute under.
 *
 * The app bundles `@gajae-code/coding-agent`, which this project does not
 * control, so its dependency tree can change under us on any runtime bump.
 * Reviewing that by hand every time is the kind of chore nobody does twice;
 * this makes the build say it instead.
 *
 * A package with disallowed terms is not automatically a failure - it fails
 * unless `scripts/release/distribution-exclusions.mjs` already removes it from
 * every distribution and records what that costs. The reverse also fails: an
 * exclusion for a package no longer in the tree is a rule guarding nothing, and
 * a stale rule reads like a considered decision long after it stopped being one.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXCLUDED_FROM_DISTRIBUTION } from './release/distribution-exclusions.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Terms that cannot ship inside this product.
 *
 * Copyleft that reaches the whole work (AGPL, GPL, SSPL), copyleft that is not
 * GPL-compatible (EPL), source-available licenses that are not free software
 * (BUSL, Elastic, Commons Clause), and anything a package declines to state.
 * File-level copyleft that stays inside its own files - MPL, CDDL - is allowed:
 * it travels with the file, not with the program around it.
 */
const DISALLOWED = [
  /\bAGPL\b/i,
  /\bGPL-[23]/i,
  /\bLGPL\b/i,
  /\bSSPL\b/i,
  /\bEPL-[12]/i,
  /\bBUSL\b/i,
  /\bElastic-2\.0\b/i,
  /Commons[- ]Clause/i,
  /\bCC-BY-NC/i,
  /\bUNLICENSED\b/i,
];

/**
 * A license expression offering a permissive alternative is taken at that
 * alternative.
 *
 * The separator has to be a whitespace-delimited `OR`, which is what SPDX
 * writes. Matching a bare word boundary instead reads the `or` inside
 * `AGPL-3.0-or-later` as a choice, splits it into `AGPL-3.0-` and `-later`,
 * finds `-later` unobjectionable, and waves the package through - which is the
 * exact failure this whole check exists to prevent.
 */
function hasPermissiveAlternative(expression) {
  if (!/\sOR\s/i.test(expression)) return false;
  return expression
    .split(/\sOR\s/i)
    .some((option) => !DISALLOWED.some((pattern) => pattern.test(option)));
}

function licenseOf(entry, installPath) {
  if (typeof entry.license === 'string' && entry.license.trim()) return entry.license.trim();
  if (Array.isArray(entry.licenses) && entry.licenses.length > 0) {
    return entry.licenses.map((value) => value?.type ?? value).filter(Boolean).join(' OR ');
  }
  // The lockfile omits a license for some packages; the installed manifest is
  // the only other place the answer exists.
  try {
    const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, installPath, 'package.json'), 'utf8'));
    const declared = manifest.license ?? manifest.licenses;
    if (typeof declared === 'string' && declared.trim()) return declared.trim();
    if (Array.isArray(declared)) {
      return declared.map((value) => value?.type ?? value).filter(Boolean).join(' OR ');
    }
  } catch {
    // Not installed, or no manifest: reported as unknown below.
  }
  return 'UNKNOWN';
}

function collectShippedPackages() {
  const lock = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package-lock.json'), 'utf8'));
  const shipped = new Map();
  for (const [installPath, entry] of Object.entries(lock.packages ?? {})) {
    // The root project is this app's own license, not a dependency's.
    if (!installPath.startsWith('node_modules/')) continue;
    // Development dependencies never reach a distribution.
    if (entry.dev || entry.devOptional) continue;
    const name = installPath.slice(installPath.lastIndexOf('node_modules/') + 'node_modules/'.length);
    shipped.set(name, { name, installPath, license: licenseOf(entry, installPath) });
  }
  return shipped;
}

const shipped = collectShippedPackages();
const excludedByName = new Map(EXCLUDED_FROM_DISTRIBUTION.map((entry) => [entry.package, entry]));
const failures = [];

for (const entry of shipped.values()) {
  const blocked = DISALLOWED.some((pattern) => pattern.test(entry.license));
  if (!blocked || hasPermissiveAlternative(entry.license)) continue;
  const exclusion = excludedByName.get(entry.name);
  if (!exclusion) {
    failures.push(
      `${entry.name} is ${entry.license}, which this product cannot distribute.\n`
      + `    It reached the tree at ${entry.installPath}.\n`
      + '    Either remove the dependency, or add it to '
      + 'scripts/release/distribution-exclusions.mjs with the reason and what excluding it costs.',
    );
    continue;
  }
  if (!new RegExp(exclusion.license.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'i').test(entry.license)) {
    failures.push(
      `${entry.name} is now ${entry.license}, but the exclusion records ${exclusion.license}.\n`
      + '    Re-read the terms before trusting the recorded reason.',
    );
  }
}

for (const exclusion of EXCLUDED_FROM_DISTRIBUTION) {
  if (shipped.has(exclusion.package)) continue;
  failures.push(
    `${exclusion.package} is excluded from every distribution but is no longer in the dependency tree.\n`
    + '    Drop the entry from scripts/release/distribution-exclusions.mjs; a rule guarding nothing '
    + 'reads like a decision long after it stopped being one.',
  );
}

if (failures.length > 0) {
  console.error('Dependency license check failed:\n');
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exitCode = 1;
} else {
  const names = EXCLUDED_FROM_DISTRIBUTION.map((entry) => entry.package).join(', ');
  console.log(
    `Checked ${shipped.size} shipped packages; no incompatible terms outside the recorded exclusions (${names}).`,
  );
}
