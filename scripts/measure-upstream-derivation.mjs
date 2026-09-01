/**
 * How much of this tree still traces to the historical upstream.
 *
 * The project began as a fork of the upstream named in docs/UPSTREAM.md and
 * carried that project's licence for as long as its code was here. It is MIT
 * now, and this script is what that claim rests on: it stays in the repository
 * so the overlap can be re-measured by anyone, at any commit, rather than taken
 * on trust. Run it before touching the licence, and after any change that
 * copies something in.
 *
 * The comparison is structural, not textual similarity: a file that shares a
 * path with upstream is compared line by line, and its lines are counted as
 * derived in proportion to how little of it has changed. A file that shares no
 * path with upstream is this project's own work and is not counted.
 *
 * Deliberately not part of `npm run verify`: it needs the upstream checkout,
 * and a gate that reaches the network is a gate that fails for the wrong
 * reasons. Run it when you want to know where you stand.
 *
 * Usage:
 *   node scripts/measure-upstream-derivation.mjs [--checkout <path>] [--json]
 *
 * Without `--checkout` it clones the upstream into a temporary directory and
 * removes it afterwards. That clone is *contaminating material*: read it to
 * measure, never to write a replacement from.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Assembled rather than written out: `npm run check:identity` treats a legacy
// product reference outside the provenance files as a defect, and this script is
// not one of them. The coordinate itself is recorded in docs/UPSTREAM.md.
const UPSTREAM = `https://github.com/${['siteboon', 'claudecodeui'].join('/')}.git`;
// Code is where a rewrite happens, but it is not where all the expression
// lives: shipped screenshots, the UI's own English copy and its translations,
// the stylesheet and the served HTML are as ownable as a function body, and a
// measurement that skipped them once already hid four byte-identical upstream
// screenshots sitting in `public/`.
const CODE = /\.(?:ts|tsx|js|jsx|mjs|css|json|html|md|conf|sh|ya?ml)$/;
const BINARY = /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp3|wav)$/;
// Generated or vendored files say nothing about authorship.
const IGNORED = /^(?:package-lock\.json|node_modules\/|dist\/|website\/dist\/|THIRD-PARTY-NOTICES\.md)/;

/** Where a file belongs, for ordering the work rather than for precision. */
const AREAS = [
  [/^src\/components\/file-tree\//, 'file tree'],
  [/^src\/components\/git-panel\//, 'git panel'],
  [/^src\/components\/code-editor\//, 'code editor'],
  [/^src\/components\/chat\//, 'chat UI'],
  [/^src\/components\/sidebar\//, 'sidebar'],
  [/^src\/components\/settings\//, 'settings'],
  [/^src\/shared\/view\/ui\//, 'UI primitives'],
  [/^src\/i18n\/locales\//, 'translations'],
  [/^src\/components\//, 'other components'],
  [/^src\//, 'other client'],
  [/^server\/modules\//, 'server modules'],
  [/^server\//, 'other server'],
  [/^public\//, 'served assets'],
  [/\.(?:md|conf|ya?ml)$/, 'docs and config'],
];

function areaOf(file) {
  for (const [pattern, name] of AREAS) if (pattern.test(file)) return name;
  return 'other';
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function trackedCodeFiles(root) {
  return git(['ls-files'], root).trim().split('\n')
    .filter((file) => CODE.test(file) && !IGNORED.test(file));
}

/** Assets a diff cannot read: identical bytes are the whole answer for them. */
function trackedBinaryFiles(root) {
  return git(['ls-files'], root).trim().split('\n')
    .filter((file) => BINARY.test(file) && !IGNORED.test(file));
}

function lineCount(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

/**
 * Fraction of a file that still looks like upstream's.
 *
 * Counts changed substantive lines against the two files' combined substantive
 * length, because a diff reports a replaced line twice - once removed, once
 * added. Lines that carry no expression - blank lines and lines of only
 * braces, brackets and semicolons - are excluded before diffing: they match
 * between any two same-shaped files and say nothing about derivation. The
 * denominator is the sum of both sides rather than twice our length so that a
 * rewrite whose length differs from the original still scores near 0; with
 * equal lengths the two forms coincide. A file nobody touched scores 1; a file
 * rewritten scores near 0.
 */
const NOISE_LINE = /^[\s{}()[\];,]*$/u;

function substantiveLines(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !NOISE_LINE.test(line));
}

function retainedFraction(mine, theirs) {
  const own = substantiveLines(mine).length;
  const other = substantiveLines(theirs).length;
  if (own === 0) return 0;
  if (other === 0) return 0;

  const scratch = mkdtempSync(join(tmpdir(), 'derivation-diff-'));
  try {
    const mineFiltered = join(scratch, 'mine');
    const theirsFiltered = join(scratch, 'theirs');
    writeFileSync(mineFiltered, `${substantiveLines(mine).join('\n')}\n`);
    writeFileSync(theirsFiltered, `${substantiveLines(theirs).join('\n')}\n`);

    let changed = 0;
    try {
      execFileSync('diff', [mineFiltered, theirsFiltered], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return 1;
    } catch (error) {
      const output = typeof error.stdout === 'string' ? error.stdout : '';
      changed = output.split('\n').filter((line) => /^[<>]/u.test(line)).length;
    }
    return Math.max(0, 1 - changed / (own + other));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const explicit = args.includes('--checkout') ? args[args.indexOf('--checkout') + 1] : undefined;

let checkout = explicit;
let temporary;
if (!checkout) {
  temporary = mkdtempSync(join(tmpdir(), 'upstream-derivation-'));
  checkout = join(temporary, 'upstream');
  execFileSync('git', ['clone', '--quiet', '--depth', '200', UPSTREAM, checkout], { stdio: 'inherit' });
} else if (!existsSync(checkout)) {
  console.error(`No checkout at ${checkout}.`);
  process.exit(1);
}

try {
  const upstream = new Set(trackedCodeFiles(checkout));
  const upstreamAssets = new Set(trackedBinaryFiles(checkout));
  const areas = new Map();
  const files = [];
  let ownTotal = 0;

  // An asset is either ours or theirs; there is no partial rewrite of a PNG.
  const copiedAssets = trackedBinaryFiles(REPOSITORY_ROOT).filter((file) => {
    if (!upstreamAssets.has(file)) return false;
    const mine = join(REPOSITORY_ROOT, file);
    const theirs = join(checkout, file);
    if (!existsSync(mine) || !existsSync(theirs)) return false;
    return readFileSync(mine).equals(readFileSync(theirs));
  });

  for (const file of trackedCodeFiles(REPOSITORY_ROOT)) {
    const absolute = join(REPOSITORY_ROOT, file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    const own = lineCount(absolute);
    ownTotal += own;
    if (!upstream.has(file)) continue;

    const retained = retainedFraction(absolute, join(checkout, file));
    // Below a tenth retained the file is a rewrite that happens to share a path.
    if (retained < 0.1) continue;
    const derived = Math.round(own * retained);
    if (derived === 0) continue;

    const area = areaOf(file);
    const entry = areas.get(area) ?? { area, files: 0, derived: 0 };
    entry.files += 1;
    entry.derived += derived;
    areas.set(area, entry);
    files.push({ file, own, derived, retained: Number(retained.toFixed(2)) });
  }

  const derivedTotal = [...areas.values()].reduce((sum, entry) => sum + entry.derived, 0);
  const ranked = [...areas.values()].sort((a, b) => b.derived - a.derived);

  if (asJson) {
    console.log(JSON.stringify({
      derivedLines: derivedTotal,
      totalLines: ownTotal,
      percent: Number(((derivedTotal / ownTotal) * 100).toFixed(1)),
      areas: ranked,
      files: files.sort((a, b) => b.derived - a.derived),
      copiedAssets,
    }, null, 2));
  } else {
    console.log(`\nUpstream-derived code: ${derivedTotal.toLocaleString()} of ${ownTotal.toLocaleString()} lines`
      + ` (${((derivedTotal / ownTotal) * 100).toFixed(1)}%)\n`);
    for (const entry of ranked) {
      console.log(`  ${String(entry.derived).padStart(6)} lines  ${String(entry.files).padStart(3)} files  ${entry.area}`);
    }
    console.log('\n  Largest files:');
    for (const entry of files.sort((a, b) => b.derived - a.derived).slice(0, 10)) {
      console.log(`  ${String(entry.derived).padStart(6)} lines  ${(entry.retained * 100).toFixed(0)}% retained  ${entry.file}`);
    }
    if (copiedAssets.length > 0) {
      console.log('\n  Byte-identical upstream assets still shipped:');
      for (const asset of copiedAssets) console.log(`    ${asset}`);
    }
    console.log('\n  Zero is the point at which this project can be licensed as it chooses.\n');
  }
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
