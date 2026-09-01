/**
 * What the lines we still share with the historical upstream actually are.
 *
 * `measure-upstream-derivation.mjs` answers "how much"; this answers "what
 * kind", which is the question the conversion step has to settle. Every line a
 * file still has in common with upstream's file at the same path is classified,
 * so a reviewer can see whether the remainder is protected expression or the
 * interface both sides are pinned to: imports of this repository's own modules,
 * declarations whose names callers depend on, literals that are observable
 * behavior (routes, error codes, i18n keys), rendered markup, and SQL.
 *
 * Usage:
 *   node scripts/classify-residual-overlap.mjs [--checkout <path>] [--json]
 *
 * The upstream checkout is contaminating material: it is read to classify,
 * never to write a replacement from.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = `https://github.com/${['siteboon', 'claudecodeui'].join('/')}.git`;
const CODE = /\.(?:ts|tsx|js|jsx)$/;
const NOISE_LINE = /^[\s{}()[\];,]*$/u;

/**
 * Categories, in the order they are tested. The first match wins, so the more
 * specific rule has to come first.
 *
 * A line is judged by the statement it belongs to, not by itself: the members
 * of a multi-line import, the names in a destructured parameter list and the
 * shorthand properties of a returned object are all part of the interface that
 * opened them, and classifying them on their own would file half the remainder
 * under "other" and hide what it is.
 */
const CATEGORIES = [
  ['import', (line) => /^\s*(?:import|export)\s.*from\s+['"]/.test(line)
    || /^\s*(?:import|export)\s+(?:type\s+)?\{\s*$/.test(line)
    || /^\s*\}\s*from\s+['"]/.test(line)],
  ['sql/ddl', (line) => /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|CREATE INDEX|FOREIGN KEY|PRIMARY KEY|REFERENCES|PRAGMA|ON CONFLICT)\b/.test(line)],
  ['markup', (line) => /^\s*(?:<\/?[A-Za-z>]|\{\/\*)/.test(line) || /className=|aria-|role=|data-slot=/.test(line)],
  ['declaration', (line) => /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:type|interface|enum|class)\s/.test(line)
    || /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s/.test(line)
    || /^\s*(?:export\s+)?(?:const|let|var)\s+[\w{[]/.test(line)
    || /^\s*[\w'"[\]]+\??\s*:\s*[A-Za-z{(['"|]/.test(line)
    || /^\s*(?:public|private|protected|readonly|static)\s/.test(line)
    || /^\s*(?:return|const|let)\s*\{\s*$/.test(line)
    || /^\s*\w+\s*\([^)]*\)\s*[:{]/.test(line)],
  ['literal', (line) => /['"`]/.test(line)],
];

function classifyLine(line) {
  for (const [name, test] of CATEGORIES) {
    if (test(line)) return name;
  }
  return 'other';
}

const OPENS = /[{([]\s*$/;
const CLOSES = /^\s*[\])}]/;

/**
 * Classify every line of a file, letting an unfinished construct carry its
 * category down to the lines it contains.
 */
function classifyFile(lines) {
  const classes = [];
  const open = [];
  for (const line of lines) {
    if (CLOSES.test(line)) open.pop();
    const own = classifyLine(line);
    const inherited = open.length > 0 ? open[open.length - 1] : null;
    const category = own === 'other' && inherited ? inherited : own;
    classes.push(category);
    if (OPENS.test(line)) open.push(category === 'other' ? inherited : category);
  }
  return classes;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function trackedCodeFiles(root) {
  return git(['ls-files'], root).trim().split('\n').filter((file) => CODE.test(file));
}

function substantiveLines(path) {
  return readFileSync(path, 'utf8').split('\n').filter((line) => !NOISE_LINE.test(line));
}

/** Indices of our lines that `diff` pairs with an identical upstream line. */
function sharedLines(mine, theirs) {
  const scratch = mkdtempSync(join(tmpdir(), 'residual-overlap-'));
  try {
    const left = join(scratch, 'mine');
    const right = join(scratch, 'theirs');
    const ourLines = substantiveLines(mine);
    writeFileSync(left, `${ourLines.join('\n')}\n`);
    writeFileSync(right, `${substantiveLines(theirs).join('\n')}\n`);

    let output = '';
    try {
      execFileSync('diff', ['-U1000000', left, right], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return ourLines.map((_, position) => position);
    } catch (error) {
      output = typeof error.stdout === 'string' ? error.stdout : '';
    }

    const shared = [];
    let index = 0;
    let inHunk = false;
    for (const row of output.split('\n')) {
      // Skip the `---`/`+++` file header, whose lines look like edits.
      if (!inHunk) {
        if (row.startsWith('@@')) inHunk = true;
        continue;
      }
      if (row.startsWith(' ')) {
        shared.push(index);
        index += 1;
      } else if (row.startsWith('-')) {
        index += 1;
      }
    }
    return shared;
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
  temporary = mkdtempSync(join(tmpdir(), 'residual-upstream-'));
  checkout = join(temporary, 'upstream');
  execFileSync('git', ['clone', '--quiet', '--depth', '200', UPSTREAM, checkout], { stdio: 'inherit' });
} else if (!existsSync(checkout)) {
  console.error(`No checkout at ${checkout}.`);
  process.exit(1);
}

try {
  const upstream = new Set(trackedCodeFiles(checkout));
  const totals = new Map();
  const files = [];

  for (const file of trackedCodeFiles(REPOSITORY_ROOT)) {
    if (!upstream.has(file)) continue;
    const absolute = join(REPOSITORY_ROOT, file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;

    const ourLines = substantiveLines(absolute);
    const categories = classifyFile(ourLines);
    const shared = sharedLines(absolute, join(checkout, file));
    if (shared.length === 0) continue;

    const breakdown = new Map();
    for (const position of shared) {
      const category = categories[position] ?? 'other';
      breakdown.set(category, (breakdown.get(category) ?? 0) + 1);
      totals.set(category, (totals.get(category) ?? 0) + 1);
    }

    files.push({
      file,
      shared: shared.length,
      breakdown: Object.fromEntries([...breakdown.entries()].sort((a, b) => b[1] - a[1])),
      expression: shared.filter((position) => (categories[position] ?? 'other') === 'other')
        .map((position) => ourLines[position])
        .slice(0, 6),
    });
  }

  const sharedTotal = [...totals.values()].reduce((sum, count) => sum + count, 0);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);

  if (asJson) {
    console.log(JSON.stringify({
      sharedLines: sharedTotal,
      categories: Object.fromEntries(ranked),
      files: files.sort((a, b) => b.shared - a.shared),
    }, null, 2));
  } else {
    console.log(`\nLines still shared with upstream: ${sharedTotal.toLocaleString()} across ${files.length} files\n`);
    for (const [category, count] of ranked) {
      const share = ((count / sharedTotal) * 100).toFixed(1);
      console.log(`  ${String(count).padStart(5)}  ${share.padStart(5)}%  ${category}`);
    }
    console.log('\n  Largest files:');
    for (const entry of files.sort((a, b) => b.shared - a.shared).slice(0, 12)) {
      const parts = Object.entries(entry.breakdown).map(([name, count]) => `${name} ${count}`).join(', ');
      console.log(`  ${String(entry.shared).padStart(4)}  ${entry.file}\n        ${parts}`);
    }
    console.log('\n  "other" is the category that needs a human reading: everything else is\n  interface, observable behavior, markup or SQL that both sides are pinned to.\n');
  }
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
