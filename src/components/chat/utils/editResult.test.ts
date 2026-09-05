import assert from 'node:assert/strict';
import test from 'node:test';

import { editResultFiles, parseRuntimeDiff } from './editResult';

/*
 * The runtime's edit result is the one shape every edit mode shares:
 * `{ path, op, move, diff }` for one file, `perFileResults[]` for an
 * apply_patch envelope, and a numbered diff (`+12|text`) either way.
 */

test('a single-file result is one file with the fallback path when the details carry none', () => {
  assert.deepEqual(editResultFiles({ diff: '+1|a', path: '/repo/a.ts' }), [
    { path: '/repo/a.ts', op: 'update', move: null, diff: '+1|a', isError: false },
  ]);
  assert.deepEqual(editResultFiles({ diff: '+1|a', firstChangedLine: 1 }, 'src/b.ts').map((file) => file.path), ['src/b.ts']);
  assert.deepEqual(editResultFiles({ diff: '+1|a' }), [], 'no path anywhere: nothing to show');
});

test('a multi-file apply_patch result keeps the order and the per-file operation', () => {
  const files = editResultFiles({
    diff: '+1|a\n-3|old',
    perFileResults: [
      { path: 'a.ts', diff: '+1|a', op: 'create' },
      { path: 'b.ts', diff: '-3|old', op: 'update', move: 'c.ts' },
      { path: 'd.ts', diff: '', op: 'delete' },
      { path: 'e.ts', diff: '', isError: true, errorText: 'no such file' },
    ],
  });
  assert.deepEqual(files.map((file) => [file.path, file.op, file.move, file.isError]), [
    ['a.ts', 'create', null, false],
    ['b.ts', 'update', 'c.ts', false],
    ['d.ts', 'delete', null, false],
    ['e.ts', 'update', null, true],
  ]);
});

test('details that are not a record yield nothing', () => {
  for (const details of [undefined, null, 'text', 42, [], { perFileResults: 'nope', path: '' }]) {
    assert.deepEqual(editResultFiles(details), [], String(details));
  }
});

test('replace-mode numbered diff: added rows know the new line, removed the old, context both', () => {
  const rows = parseRuntimeDiff([
    ' 1|import a',
    ' 2|',
    '-3|const x = 1;',
    '+3|const x = 2;',
    '+4|const y = 3;',
    ' 4|export { x };',
    ' 5|...',
    ' 12|tail',
  ].join('\n'));
  assert.deepEqual(rows, [
    { kind: 'context', content: 'import a', oldLine: 1, newLine: 1 },
    { kind: 'context', content: '', oldLine: 2, newLine: 2 },
    { kind: 'removed', content: 'const x = 1;', oldLine: 3, newLine: null },
    { kind: 'added', content: 'const x = 2;', oldLine: null, newLine: 3 },
    { kind: 'added', content: 'const y = 3;', oldLine: null, newLine: 4 },
    { kind: 'context', content: 'export { x };', oldLine: 4, newLine: 5 },
    { kind: 'context', content: '...', oldLine: 5, newLine: 6 },
    { kind: 'context', content: 'tail', oldLine: 12, newLine: 13 },
  ]);
});

test('patch-mode hunks reset the new-line offset from the header and become separators', () => {
  const rows = parseRuntimeDiff([
    '@@ -1,2 +1,1 @@',
    '-1|a',
    ' 2|b',
    '@@ -10,2 +9,3 @@',
    ' 10|c',
    '+10|d',
    ' 11|e',
    'stray line without a number',
  ].join('\n'));
  assert.deepEqual(rows, [
    { kind: 'hunk', content: '@@ -1,2 +1,1 @@' },
    { kind: 'removed', content: 'a', oldLine: 1, newLine: null },
    { kind: 'context', content: 'b', oldLine: 2, newLine: 1 },
    { kind: 'hunk', content: '@@ -10,2 +9,3 @@' },
    { kind: 'context', content: 'c', oldLine: 10, newLine: 9 },
    { kind: 'added', content: 'd', oldLine: null, newLine: 10 },
    { kind: 'context', content: 'e', oldLine: 11, newLine: 11 },
  ]);
});

test('a line whose content contains a pipe keeps everything after the first one', () => {
  assert.deepEqual(parseRuntimeDiff('+7|a || b'), [{ kind: 'added', content: 'a || b', oldLine: null, newLine: 7 }]);
  assert.deepEqual(parseRuntimeDiff(''), []);
});
