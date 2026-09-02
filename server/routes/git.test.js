import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink as fsSymlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isBinaryContent,
  inspectUntrackedFile,
  parseGitLogWithStats,
  parseGitNumstatOutput,
  parseGitStatusEntries,
  parseGitStatusOutput,
  projectRelativeGitPath,
  readProjectDiff,
} from './git.js';

// Builds `git status --porcelain=v1 -z` output: NUL-separated entries with a
// trailing NUL, exactly as git emits it.
const porcelain = (...entries) => entries.join('\0') + '\0';

async function temporaryRepository(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gajae-git-diff-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  execFileSync('git', ['init', '-q'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: directory });
  return directory;
}

function git(directory, ...args) {
  execFileSync('git', args, { cwd: directory });
}

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

test('parseGitStatusEntries consumes the old path for worktree renames', () => {
  assert.deepEqual(parseGitStatusEntries(porcelain(' R renamed-to.ts', 'renamed-from.ts')), [{
    path: 'renamed-to.ts',
    oldPath: 'renamed-from.ts',
    status: 'renamed',
    staged: false,
  }]);
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
    '2\t1\tliteral => arrow.ts',
  ].join('\0') + '\0';

  assert.deepEqual(parseGitNumstatOutput(output), [
    { path: 'modified.ts', oldPath: null, status: 'modified', additions: 3, deletions: 2, binary: false },
    { path: 'added.ts', oldPath: null, status: 'added', additions: 5, deletions: 0, binary: false },
    { path: 'deleted.ts', oldPath: null, status: 'deleted', additions: 0, deletions: 4, binary: false },
    { path: 'binary.png', oldPath: null, status: 'modified', additions: 0, deletions: 0, binary: true },
    { path: 'new-name.ts', oldPath: 'old-name.ts', status: 'renamed', additions: 1, deletions: 1, binary: false },
    { path: 'literal => arrow.ts', oldPath: null, status: 'modified', additions: 2, deletions: 1, binary: false },
  ]);
});

test('isBinaryContent identifies NUL bytes in untracked file content', () => {
  assert.equal(isBinaryContent(Buffer.from('plain text')), false);
  assert.equal(isBinaryContent(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0])), true);
});

test('inspectUntrackedFile isolates deletion and permission races', async (t) => {
  const repository = await temporaryRepository(t);
  assert.deepEqual(await inspectUntrackedFile(repository, 'already-gone.txt'), { previewUnsupported: true });
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

test('projectRelativeGitPath removes only the registered project prefix', () => {
  assert.equal(projectRelativeGitPath('apps/editor/src/file.ts', 'apps/editor'), 'src/file.ts');
  assert.equal(projectRelativeGitPath('apps/other/file.ts', 'apps/editor'), null);
  assert.equal(projectRelativeGitPath('root-file.ts', ''), 'root-file.ts');
});

test('readProjectDiff scopes nested projects and returns project-relative paths', async (t) => {
  const repository = await temporaryRepository(t);
  await mkdir(path.join(repository, 'apps/editor'), { recursive: true });
  await writeFile(path.join(repository, 'apps/editor/tracked.txt'), 'before\n');
  await writeFile(path.join(repository, 'outside.txt'), 'before\n');
  git(repository, 'add', '.');
  git(repository, 'commit', '-qm', 'initial');

  await writeFile(path.join(repository, 'apps/editor/tracked.txt'), 'after\n');
  await writeFile(path.join(repository, 'apps/editor/new.txt'), 'new\n');
  await writeFile(path.join(repository, 'outside.txt'), 'private\n');

  const result = await readProjectDiff(path.join(repository, 'apps/editor'));
  assert.deepEqual(result.files.map((file) => file.path).sort(), ['new.txt', 'tracked.txt']);
  assert.equal(JSON.stringify(result).includes('outside.txt'), false);
  assert.match(result.files.find((file) => file.path === 'new.txt').patch, /\+new/);
});

test('readProjectDiff previews unborn text files and identifies binary files', async (t) => {
  const repository = await temporaryRepository(t);
  await writeFile(path.join(repository, 'draft.txt'), '++first\n--second\n');
  await writeFile(path.join(repository, 'image.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));

  const result = await readProjectDiff(repository);
  assert.equal(result.hasCommits, false);
  const text = result.files.find((file) => file.path === 'draft.txt');
  assert.equal(text.additions, 2);
  assert.match(text.patch, /\+\+\+first\n\+--second/);
  const binary = result.files.find((file) => file.path === 'image.bin');
  assert.equal(binary.binary, true);
  assert.equal(binary.patch, null);
});

test('readProjectDiff bounds large patches and keeps totals above the patch budget', async (t) => {
  const repository = await temporaryRepository(t);
  await Promise.all(Array.from({ length: 1001 }, (_, index) =>
    writeFile(path.join(repository, `file-${String(index).padStart(4, '0')}.txt`), `${index}\n`)));
  await writeFile(path.join(repository, 'file-0000.txt'), `${'x'.repeat(60000)}\n`);

  const result = await readProjectDiff(repository);
  assert.equal(result.files.length, 1000);
  assert.equal(result.totalFiles, 1001);
  assert.equal(result.truncated, true);
  const oversized = result.files.find((file) => file.path === 'file-0000.txt');
  assert.equal(oversized.patch, null);
  assert.equal(oversized.tooLarge, true);
  assert.equal(result.files.at(-1).patchOmitted, true);
});

test('readProjectDiff treats Git pathspec magic as a literal nested-project filename', async (t) => {
  const repository = await temporaryRepository(t);
  const project = path.join(repository, 'nested');
  await mkdir(project);
  await writeFile(path.join(project, ':(top)**'), 'before\n');
  await writeFile(path.join(repository, 'outside.txt'), 'before\n');
  git(repository, 'add', '.');
  git(repository, 'commit', '-qm', 'initial');

  await writeFile(path.join(project, ':(top)**'), 'after\n');
  await writeFile(path.join(repository, 'outside.txt'), 'private\n');

  const result = await readProjectDiff(project);
  assert.deepEqual(result.files.map((file) => file.path), [':(top)**']);
  assert.match(result.files[0].patch, /\+after/);
  assert.doesNotMatch(result.files[0].patch, /private/);
});

test('readProjectDiff keeps pure rename counts and source metadata', async (t) => {
  const repository = await temporaryRepository(t);
  await writeFile(path.join(repository, 'before.txt'), 'unchanged\n');
  git(repository, 'add', '.');
  git(repository, 'commit', '-qm', 'initial');
  git(repository, 'mv', 'before.txt', 'after.txt');

  const result = await readProjectDiff(repository);
  assert.deepEqual(result.files.map((file) => ({
    path: file.path,
    oldPath: file.oldPath,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
  })), [{
    path: 'after.txt',
    oldPath: 'before.txt',
    status: 'renamed',
    additions: 0,
    deletions: 0,
  }]);
});

test('readProjectDiff previews dangling symlinks without following their targets', {
  skip: process.platform === 'win32',
}, async (t) => {
  const repository = await temporaryRepository(t);
  await fsSymlink('missing\ntarget', path.join(repository, 'link'));

  const result = await readProjectDiff(repository);
  const link = result.files.find((file) => file.path === 'link');
  assert.match(link.patch, /\+missing\n\+target/);
  assert.equal(link.binary, false);
});
