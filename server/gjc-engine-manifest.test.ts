import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * The engine's file set has to be a fact, not a memory.
 *
 * `server/gjc-*` is about to become the contents of a different repository, and
 * a file that lands in that namespace without a decision behind it either moves
 * when it should not or stays when it should not. Both failures are silent, and
 * both are found long afterwards.
 *
 * `gjc-engine-manifest.json` is the single declaration: eslint reads it to
 * enforce the import boundary, and the extraction will read it to know what to
 * move. This test keeps it honest in both directions.
 */

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'server', 'gjc-engine-manifest.json'), 'utf8'));

const declared = new Map<string, string>();
for (const [group, entries] of Object.entries(manifest)) {
  if (group.startsWith('$')) continue;
  if (Array.isArray(entries)) {
    for (const file of entries) declared.set(file, group);
  } else if (entries && typeof entries === 'object') {
    for (const file of Object.keys(entries)) declared.set(file, group);
  }
}

const tracked = execFileSync('git', ['ls-files', 'server/gjc-*'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

test('every file in the engine namespace has a recorded side', () => {
  const undeclared = tracked.filter((file) => !declared.has(file));
  assert.deepEqual(
    undeclared,
    [],
    'these files sit in server/gjc-* with no entry in gjc-engine-manifest.json. '
    + 'Adding one is a decision about whether the file ships closed with the engine '
    + 'or stays with the application; make it deliberately.',
  );
});

test('the manifest describes no file that does not exist', () => {
  const trackedSet = new Set(tracked);
  const missing = [...declared.keys()].filter((file) => !trackedSet.has(file));
  assert.deepEqual(
    missing,
    [],
    'the manifest lists files that are not in server/gjc-*. A declaration guarding '
    + 'nothing reads like a decision long after it stopped being one.',
  );
});

test('the application side of the manifest states why each file stays', () => {
  for (const [file, reason] of Object.entries(manifest.application)) {
    assert.equal(typeof reason, 'string', `${file} needs a reason, not a placeholder`);
    assert.ok(
      (reason as string).length > 40,
      `${file} needs a reason someone can act on, not a label`,
    );
  }
});

test('nothing declared as engine imports the application', () => {
  // The eslint boundary rule covers this for source files. Repeating it here
  // over the manifest catches the case eslint cannot see: a file added to the
  // engine list that was never in the engine element, and test files, which are
  // outside the element entirely but still move with the engine.
  const appImport = /from\s+'(?:\.\.\/src\/|\.\/modules\/|@\/modules\/|\.\/services\/|@\/services\/)/u;
  const engineFiles = [
    ...(manifest.engine as string[]),
    ...(manifest.engineTests as string[]),
  ];

  for (const file of engineFiles) {
    const source = readFileSync(join(REPOSITORY_ROOT, file), 'utf8');
    const offending = source
      .split('\n')
      .filter((line) => appImport.test(line))
      .map((line) => line.trim());
    assert.deepEqual(
      offending,
      [],
      `${relative(REPOSITORY_ROOT, file)} is declared as engine but imports the application. `
      + 'The engine cannot take that import with it.',
    );
  }
});
