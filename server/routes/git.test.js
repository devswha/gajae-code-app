import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachDiffPatches,
  buildNoCommitsDiffFiles,
  parseGitLogWithStats,
  parseGitNumstatOutput,
  parseGitStatusOutput,
  splitGitDiffPatches,
} from './git.js';

// Builds `git status --porcelain=v1 -z` output: NUL-separated entries with a
// trailing NUL, exactly as git emits it.
const porcelain = (...entries) => entries.join('\0') + '\0';

test('parseGitStatusOutput buckets files and reports index-side staging', () => {
  const output = porcelain(
    'M  staged-modified.ts',
    ' M unstaged-modified.ts',
    'MM staged-and-unstaged.ts',
    'A  staged-new.ts',
    'D  staged-deleted.ts',
    ' D unstaged-deleted.ts',
    '?? untracked.ts',
  );

  const result = parseGitStatusOutput(output);

  assert.deepEqual(result.modified, ['staged-modified.ts', 'unstaged-modified.ts', 'staged-and-unstaged.ts']);
  assert.deepEqual(result.added, ['staged-new.ts']);
  assert.deepEqual(result.deleted, ['staged-deleted.ts', 'unstaged-deleted.ts']);
  assert.deepEqual(result.untracked, ['untracked.ts']);
  // Only index-side (X) changes count as staged.
  assert.deepEqual(result.staged, [
    'staged-modified.ts',
    'staged-and-unstaged.ts',
    'staged-new.ts',
    'staged-deleted.ts',
  ]);
});

test('parseGitStatusOutput keeps paths with spaces intact (-z output has no quoting)', () => {
  const result = parseGitStatusOutput(porcelain('M  src/my folder/some file.ts'));
  assert.deepEqual(result.modified, ['src/my folder/some file.ts']);
  assert.deepEqual(result.staged, ['src/my folder/some file.ts']);
});

test('parseGitStatusOutput tracks the post-rename path and skips the original', () => {
  const output = porcelain('R  renamed-to.ts', 'renamed-from.ts', ' M other.ts');
  const result = parseGitStatusOutput(output);

  assert.deepEqual(result.modified, ['renamed-to.ts', 'other.ts']);
  assert.deepEqual(result.staged, ['renamed-to.ts']);
  // The pre-rename path is metadata, not a change entry.
  assert.equal(JSON.stringify(result).includes('renamed-from.ts'), false);
});

test('parseGitStatusOutput never reports merge conflicts as staged', () => {
  const output = porcelain('UU conflicted.ts', 'AA both-added.ts', 'DD both-deleted.ts');
  const result = parseGitStatusOutput(output);

  assert.deepEqual(result.modified, ['conflicted.ts', 'both-added.ts', 'both-deleted.ts']);
  assert.deepEqual(result.staged, []);
});

test('parseGitStatusOutput handles empty output', () => {
  assert.deepEqual(parseGitStatusOutput(''), {
    modified: [],
    added: [],
    deleted: [],
    untracked: [],
    staged: [],
  });
});

test('parseGitNumstatOutput parses modified, added, deleted, binary, and renamed files', () => {
  const output = [
    '3\t2\tmodified.ts',
    '5\t0\tadded.ts',
    '0\t4\tdeleted.ts',
    '-\t-\tbinary.png',
    '1\t1\t',
    'old-name.ts',
    'new-name.ts',
    '2\t1\told-display.ts => new-display.ts',
  ].join('\0') + '\0';

  assert.deepEqual(parseGitNumstatOutput(output), [
    { path: 'modified.ts', oldPath: null, status: 'modified', additions: 3, deletions: 2, binary: false },
    { path: 'added.ts', oldPath: null, status: 'added', additions: 5, deletions: 0, binary: false },
    { path: 'deleted.ts', oldPath: null, status: 'deleted', additions: 0, deletions: 4, binary: false },
    { path: 'binary.png', oldPath: null, status: 'modified', additions: 0, deletions: 0, binary: true },
    { path: 'new-name.ts', oldPath: 'old-name.ts', status: 'renamed', additions: 1, deletions: 1, binary: false },
    { path: 'new-display.ts', oldPath: 'old-display.ts', status: 'renamed', additions: 2, deletions: 1, binary: false },
  ]);
});

test('splitGitDiffPatches preserves file hunks and recognizes rename segments', () => {
  const output = [
    'diff --git a/one.ts b/one.ts',
    'index 111..222 100644',
    '--- a/one.ts',
    '+++ b/one.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    'diff --git a/two.ts b/two.ts',
    'index 333..444 100644',
    '--- a/two.ts',
    '+++ b/two.ts',
    '@@ -1 +1 @@',
    '-before',
    '+after',
    'diff --git "a/a file.ts" "b/a file.ts"',
    '--- "a/a file.ts"',
    '+++ "b/a file.ts"',
    '@@ -1 +1 @@',
    '-one',
    '+two',
    'diff --git a/old-name.ts b/new-name.ts',
    'similarity index 100%',
    'rename from old-name.ts',
    'rename to new-name.ts',
  ].join('\n');

  const patches = splitGitDiffPatches(output);
  assert.equal(patches.length, 4);
  assert.equal(patches[0].path, 'one.ts');
  assert.match(patches[0].patch, /@@ -1 \+1 @@\n-old\n\+new/);
  assert.equal(patches[1].path, 'two.ts');
  assert.match(patches[1].patch, /-before\n\+after/);
  assert.equal(patches[2].path, 'a file.ts');
  assert.match(patches[2].patch, /-one\n\+two/);
  assert.equal(patches[3].path, 'new-name.ts');
  assert.match(patches[3].patch, /rename from old-name\.ts\nrename to new-name\.ts/);
});

test('attachDiffPatches enforces per-file and total patch size caps', () => {
  const files = [
    { path: 'first.ts', binary: false },
    { path: 'oversized.ts', binary: false },
    { path: 'second.ts', binary: false },
    { path: 'third.ts', binary: false },
  ];
  const patches = [
    { path: 'first.ts', patch: '1234' },
    { path: 'oversized.ts', patch: '123456' },
    { path: 'second.ts', patch: '5678' },
    { path: 'third.ts', patch: '9' },
  ];

  const result = attachDiffPatches(files, patches, 5, 8);
  assert.equal(result[0].patch, '1234');
  assert.equal(result[0].tooLarge, false);
  assert.equal(result[1].patch, null);
  assert.equal(result[1].tooLarge, true);
  assert.equal(result[2].patch, '5678');
  assert.equal(result[2].tooLarge, false);
  assert.equal(result[3].patch, null);
  assert.equal(result[3].tooLarge, true);
});

test('buildNoCommitsDiffFiles lists tracked and untracked porcelain changes without patches', () => {
  const files = buildNoCommitsDiffFiles(porcelain(
    'A  staged.ts',
    ' M modified.ts',
    '?? untracked.ts',
  ));

  assert.deepEqual(files, [
    {
      path: 'staged.ts', oldPath: null, status: 'added', staged: true,
      additions: 0, deletions: 0, patch: null, binary: false, tooLarge: false,
    },
    {
      path: 'modified.ts', oldPath: null, status: 'modified', staged: false,
      additions: 0, deletions: 0, patch: null, binary: false, tooLarge: false,
    },
    {
      path: 'untracked.ts', oldPath: null, status: 'untracked', staged: false,
      additions: 0, deletions: 0, patch: null, binary: false, tooLarge: false,
    },
  ]);
});

// Builds one `git log --pretty=format:%H%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%ad%x1f%s` line.
const US = '\u001f';
const logLine = (hash, parents, refs, subject) =>
  [hash, parents, refs, 'Alice', 'a@x.com', '2026-07-06T10:00:00+03:00', subject].join(US);

test('parseGitLogWithStats parses commits with parents, refs, and shortstat lines', () => {
  const output = [
    logLine('c3', 'c2', 'HEAD -> main, origin/main, tag: v1.0', 'feat: add | pipes | to subject'),
    ' 3 files changed, 10 insertions(+), 2 deletions(-)',
    '',
    logLine('c2', 'c1 c0', '', 'Merge branch feature'),
    '',
    logLine('c0', '', '', 'initial commit'),
    ' 1 file changed, 1 insertion(+)',
  ].join('\n');

  const commits = parseGitLogWithStats(output);

  assert.equal(commits.length, 3);
  assert.deepEqual(commits[0].parents, ['c2']);
  assert.deepEqual(commits[0].refs, ['HEAD -> main', 'origin/main', 'tag: v1.0']);
  // Pipes in the subject survive because fields are joined with .
  assert.equal(commits[0].message, 'feat: add | pipes | to subject');
  assert.equal(commits[0].stats, '3 files changed, 10 insertions(+), 2 deletions(-)');

  // Merge commit: two parents, no shortstat line.
  assert.deepEqual(commits[1].parents, ['c1', 'c0']);
  assert.equal(commits[1].stats, '');

  // Root commit: no parents.
  assert.deepEqual(commits[2].parents, []);
  assert.equal(commits[2].stats, '1 file changed, 1 insertion(+)');
});

test('parseGitLogWithStats handles empty output', () => {
  assert.deepEqual(parseGitLogWithStats(''), []);
});
