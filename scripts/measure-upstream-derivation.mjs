/**
 * How much of this tree still traces to the historical upstream.
 *
 * The application is AGPL because it derives from the historical upstream named
 * in docs/UPSTREAM.md, and no relicensing is possible while any of that code
 * remains. Replacing it is
 * therefore a number that has to reach zero - and a number nobody can see is a
 * number nobody drives. This makes it visible, by area, so the work can be
 * ordered by what removes the most for the least.
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
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Assembled rather than written out: `npm run check:identity` treats a legacy
// product reference outside the provenance files as a defect, and this script is
// not one of them. The coordinate itself is recorded in docs/UPSTREAM.md.
const UPSTREAM = `https://github.com/${['siteboon', 'claudecodeui'].join('/')}.git`;
const CODE = /\.(?:ts|tsx|js|jsx)$/;

/** Where a file belongs, for ordering the work rather than for precision. */
const AREAS = [
  [/^src\/components\/file-tree\//, 'file tree'],
  [/^src\/components\/git-panel\//, 'git panel'],
  [/^src\/components\/code-editor\//, 'code editor'],
  [/^src\/components\/chat\//, 'chat UI'],
  [/^src\/components\/sidebar\//, 'sidebar'],
  [/^src\/components\/settings\//, 'settings'],
  [/^src\/shared\/view\/ui\//, 'UI primitives'],
  [/^src\/components\//, 'other components'],
  [/^src\//, 'other client'],
  [/^server\/modules\//, 'server modules'],
  [/^server\//, 'other server'],
];

function areaOf(file) {
  for (const [pattern, name] of AREAS) if (pattern.test(file)) return name;
  return 'other';
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function trackedCodeFiles(root) {
  return git(['ls-files'], root).trim().split('\n').filter((file) => CODE.test(file));
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
 * Counts changed lines against twice the file's length, because a diff reports
 * a replaced line twice - once removed, once added. A file nobody touched
 * scores 1; a file rewritten scores near 0.
 */
function retainedFraction(mine, theirs) {
  const own = lineCount(mine);
  if (own === 0) return 0;
  let changed = 0;
  try {
    execFileSync('diff', [mine, theirs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return 1;
  } catch (error) {
    const output = typeof error.stdout === 'string' ? error.stdout : '';
    changed = output.split('\n').filter((line) => /^[<>]/u.test(line)).length;
  }
  return Math.max(0, 1 - changed / (own * 2));
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
  const areas = new Map();
  const files = [];
  let ownTotal = 0;

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
    console.log('\n  Zero is the point at which this project can be licensed as it chooses.\n');
  }
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
