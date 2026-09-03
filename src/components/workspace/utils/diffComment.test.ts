import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDiffComment, formatDiffReview } from './diffComment';

/*
 * A line comment becomes the next message's draft: what the user said, then
 * the pointer (path:line, the line an added row carries being the new one)
 * and the quoted line. The agent reads this without ever seeing the tab.
 */

const added = { path: 'src/foo.ts', oldLine: null, newLine: 42, marker: '+' as const, content: 'const x = 1;' };

test('an added line comments by its new number and quotes with the + marker', () => {
  assert.equal(
    formatDiffComment(added, '여기 상수 이름이 애매해요'),
    '여기 상수 이름이 애매해요\n\nsrc/foo.ts:42\n> +const x = 1;',
  );
});

test('a removed line comments by its old number; context carries no marker', () => {
  const removed = { path: 'a.ts', oldLine: 7, newLine: null, marker: '-' as const, content: 'old();' };
  assert.equal(formatDiffComment(removed, 'why'), 'why\n\na.ts:7\n> -old();');
  const context = { path: 'a.ts', oldLine: 7, newLine: 9, marker: ' ' as const, content: 'keep();' };
  assert.equal(formatDiffComment(context, 'why'), 'why\n\na.ts:9\n> keep();');
});

test('a row with no numbers references the file alone; the comment is trimmed', () => {
  const unnumbered = { path: 'new.ts', oldLine: null, newLine: null, marker: '+' as const, content: 'x' };
  assert.equal(formatDiffComment(unnumbered, '  note  '), 'note\n\nnew.ts\n> +x');
});

test('a review is its comments in order, blank-line separated; one comment is just that comment', () => {
  const first = { path: 'a.ts', oldLine: null, newLine: 1, marker: '+' as const, content: 'one' };
  const second = { path: 'b.ts', oldLine: 3, newLine: null, marker: '-' as const, content: 'two' };
  assert.equal(formatDiffReview([{ location: first, comment: 'why' }]), formatDiffComment(first, 'why'));
  assert.equal(
    formatDiffReview([{ location: first, comment: 'why' }, { location: second, comment: 'and this' }]),
    'why\n\na.ts:1\n> +one\n\nand this\n\nb.ts:3\n> -two',
  );
  assert.equal(formatDiffReview([]), '');
});
