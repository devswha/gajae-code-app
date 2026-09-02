import assert from 'node:assert/strict';
import test from 'node:test';

import { parseUnifiedDiff } from './unifiedDiff';

test('parses hunk headers and assigns paired old and new line numbers', () => {
  const rows = parseUnifiedDiff([
    'diff --git a/example.ts b/example.ts',
    'index 1111111..2222222 100644',
    '--- a/example.ts',
    '+++ b/example.ts',
    '@@ -2,2 +2,3 @@ function example() {',
    ' unchanged();',
    '-old();',
    '+new();',
    '+another();',
  ].join('\n'));

  assert.deepEqual(rows, [
    { kind: 'hunk', content: '@@ -2,2 +2,3 @@ function example() {' },
    { kind: 'context', content: 'unchanged();', oldLine: 2, newLine: 2 },
    { kind: 'removed', content: 'old();', oldLine: 3, newLine: null },
    { kind: 'added', content: 'new();', oldLine: null, newLine: 3 },
    { kind: 'added', content: 'another();', oldLine: null, newLine: 4 },
  ]);
});

test('drops rename preambles and returns no rows for an empty patch', () => {
  assert.deepEqual(parseUnifiedDiff([
    'diff --git a/old-name.ts b/new-name.ts',
    'similarity index 100%',
    'rename from old-name.ts',
    'rename to new-name.ts',
  ].join('\n')), []);
  assert.deepEqual(parseUnifiedDiff(''), []);
});
