import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb } from '@/modules/database/index.js';
import { descendIntoChild, isWorkspaceRoot, listChildRepos, resolveWorkspaceTarget } from '@/modules/projects/services/workspace-target.service.js';
import { scoreWorkspaceCandidates } from '@/modules/projects/services/workspace-target-scoring.js';
import { AppError } from '@/shared/utils.js';

async function withDatabase(action: () => void | Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'workspace-target-db-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'app.sqlite');
  try {
    await initializeDatabase();
    await action();
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

async function makeGitRepo(dir: string, packageName?: string | { invalid: true }): Promise<void> {
  await mkdir(path.join(dir, '.git'), { recursive: true });
  if (packageName !== undefined) {
    const content = packageName && typeof packageName === 'object'
      ? '{ this is not valid json'
      : JSON.stringify({ name: packageName });
    await writeFile(path.join(dir, 'package.json'), content);
  }
}

const code = (error: unknown) => (error instanceof AppError ? error.code : undefined);
const statusCode = (error: unknown) => (error instanceof AppError ? error.statusCode : undefined);

// ---- scoring (pure function) ----

test('scoring: exact token match beats substring, prefix, and recency', () => {
  const children = [
    { path: '/w/dashboard', name: 'dashboard', packageName: null, mtimeMs: 1000 },
    { path: '/w/dash-utils', name: 'dash-utils', packageName: null, mtimeMs: 2000 },
    { path: '/w/other', name: 'other', packageName: null, mtimeMs: 3000 },
  ];
  const results = scoreWorkspaceCandidates('fix the dashboard bug', children);
  assert.deepEqual(results[0], { path: '/w/dashboard', name: 'dashboard', score: 100, reason: 'mention' });
});

test('scoring: a name outside the token class is found as a whole mention', () => {
  const children = [
    { path: '/w/웹툰분석', name: '웹툰분석', packageName: null, mtimeMs: 1000 },
    { path: '/w/api', name: 'api', packageName: null, mtimeMs: 2000 }, // length 3: too short for the whole-mention rule
  ];
  const results = scoreWorkspaceCandidates('웹툰분석 api 고쳐줘', children);
  const byName = new Map(results.map((entry) => [entry.name, entry]));
  assert.equal(byName.get('웹툰분석')?.score, 80);
  assert.equal(byName.get('웹툰분석')?.reason, 'mention');
  // `api` still scores as an exact token, the whole-mention rule is only for longer names.
  assert.equal(byName.get('api')?.score, 100);
});

test('scoring: a repo whose name is a prefix of the mentioned one is not a mention', () => {
  const children = [
    { path: '/w/gajae-code', name: 'gajae-code', packageName: null, mtimeMs: 3000 },
    { path: '/w/gajae-code-app', name: 'gajae-code-app', packageName: null, mtimeMs: 1000 },
    { path: '/w/gajae-code-hotfix', name: 'gajae-code-hotfix', packageName: 'gajae-code', mtimeMs: 2000 },
  ];
  const results = scoreWorkspaceCandidates('gajae-code-app에 칩 넣어줘', children);
  // Neither the shorter directory name nor the clone's package.json name is a
  // mention; both fall back to recency behind the real target.
  assert.deepEqual(results.map((entry) => [entry.name, entry.score]), [
    ['gajae-code-app', 100],
    ['gajae-code', 0],
    ['gajae-code-hotfix', 0],
  ]);
});

test('scoring: prefix match requires token length >= 3', () => {
  const children = [{ path: '/w/dashboard', name: 'dashboard', packageName: null, mtimeMs: 1000 }];
  assert.equal(scoreWorkspaceCandidates('dash it', children)[0].score, 40);
  assert.deepEqual(scoreWorkspaceCandidates('dash it', children)[0].reason, 'partial');
  assert.equal(scoreWorkspaceCandidates('da it', children)[0].score, 0);
});

test('scoring: package.json name contributes as a candidate name alongside the directory name', () => {
  // Scope-stripping happens where the caller reads package.json; the pure scoring
  // function receives the already-stripped name.
  const children = [{ path: '/w/dir-name', name: 'dir-name', packageName: 'real-name', mtimeMs: 1000 }];
  assert.equal(scoreWorkspaceCandidates('fix real-name issue', children)[0].score, 100);
});

test('scoring: empty text returns every child, reason recent, sorted by mtime desc', () => {
  const children = [
    { path: '/w/a', name: 'a', packageName: null, mtimeMs: 100 },
    { path: '/w/b', name: 'b', packageName: null, mtimeMs: 300 },
    { path: '/w/c', name: 'c', packageName: null, mtimeMs: 200 },
  ];
  assert.deepEqual(scoreWorkspaceCandidates('   ', children), [
    { path: '/w/b', name: 'b', score: 0, reason: 'recent' },
    { path: '/w/c', name: 'c', score: 0, reason: 'recent' },
    { path: '/w/a', name: 'a', score: 0, reason: 'recent' },
  ]);
});

test('scoring: every child comes back, mentions first, the rest by recency', () => {
  const children = Array.from({ length: 10 }, (_, index) => ({
    path: `/w/repo${index}`,
    name: `repo${index}`,
    packageName: null,
    mtimeMs: index,
  }));
  const results = scoreWorkspaceCandidates('mention repo3 and repo8', children);
  assert.equal(results.length, 10);
  // Both mentions score 100; the more recently touched one (repo8) leads.
  assert.deepEqual(results.slice(0, 2).map((entry) => entry.name), ['repo8', 'repo3']);
  // Everything else is unscored and ordered newest first so a picker stays useful.
  assert.ok(results.slice(2).every((entry) => entry.score === 0));
  assert.deepEqual(results.slice(2, 5).map((entry) => entry.name), ['repo9', 'repo7', 'repo6']);
});

// ---- service (fixture directory + db) ----

async function withWorkspaceFixture(action: (fixture: {
  workspaceDir: string;
  repoA: string;
  repoB: string;
}) => Promise<void>): Promise<void> {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), 'gajae-workspace-'));
  try {
    const repoA = path.join(workspaceDir, 'alpha');
    const repoB = path.join(workspaceDir, 'beta');
    await makeGitRepo(repoA, 'alpha-pkg');
    await makeGitRepo(repoB);
    await mkdir(path.join(workspaceDir, '.hidden-dir'), { recursive: true });
    await mkdir(path.join(workspaceDir, 'node_modules'), { recursive: true });
    await mkdir(path.join(workspaceDir, 'plain-dir'), { recursive: true }); // no .git
    await action({ workspaceDir, repoA, repoB });
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

test('isWorkspaceRoot / listChildRepos: detects workspace, skips hidden/node_modules/non-git dirs', async () => {
  await withWorkspaceFixture(async ({ workspaceDir, repoA, repoB }) => {
    assert.equal(await isWorkspaceRoot(workspaceDir), true);
    const children = await listChildRepos(workspaceDir);
    const paths = children.map((child) => child.path).sort();
    assert.deepEqual(paths, [repoA, repoB].sort());

    // A directory that IS a git worktree itself is not a workspace root.
    assert.equal(await isWorkspaceRoot(repoA), false);

    // A directory with no git-containing children is not a workspace root.
    const plainRoot = await mkdtemp(path.join(tmpdir(), 'gajae-plain-'));
    try {
      await mkdir(path.join(plainRoot, 'child'), { recursive: true });
      assert.equal(await isWorkspaceRoot(plainRoot), false);
    } finally {
      await rm(plainRoot, { recursive: true, force: true });
    }
  });
});

test('resolveWorkspaceTarget: 404s for unknown project, reports non-workspace projects, scores workspace children', async () => {
  await withDatabase(async () => {
    await assert.rejects(
      () => resolveWorkspaceTarget('unknown-project', ''),
      (error: unknown) => code(error) === 'PROJECT_NOT_FOUND' && statusCode(error) === 404,
    );

    await withWorkspaceFixture(async ({ workspaceDir, repoA }) => {
      const workspaceProject = projectsDb.createProjectPath(workspaceDir).project;
      assert.ok(workspaceProject);
      const result = await resolveWorkspaceTarget(workspaceProject.project_id, 'work on alpha-pkg please');
      assert.equal(result.isWorkspace, true);
      assert.equal(result.candidates[0].path, repoA);
      assert.equal(result.candidates[0].score, 100);

      const nonWorkspaceProject = projectsDb.createProjectPath(repoA).project;
      assert.ok(nonWorkspaceProject);
      const nonWorkspaceResult = await resolveWorkspaceTarget(nonWorkspaceProject.project_id, 'anything');
      assert.deepEqual(nonWorkspaceResult, { isWorkspace: false, candidates: [] });
    });
  });
});

test('descendIntoChild: creates an explicit sidebar project on first call, reuses on second, un-archives if archived', async () => {
  await withDatabase(async () => {
    await withWorkspaceFixture(async ({ workspaceDir, repoA }) => {
      const workspaceProject = projectsDb.createProjectPath(workspaceDir).project;
      assert.ok(workspaceProject);

      const first = await descendIntoChild(workspaceProject.project_id, repoA);
      assert.equal(first.created, true);
      assert.equal(first.project.fullPath, repoA);
      // The sidebar lists explicit projects only; a repo the user descended
      // into has to show up there with its session.
      assert.equal(first.project.origin, 'explicit');

      const second = await descendIntoChild(workspaceProject.project_id, repoA);
      assert.equal(second.created, false);
      assert.equal(second.project.projectId, first.project.projectId);

      projectsDb.updateProjectIsArchivedById(first.project.projectId, true);
      const archivedRow = projectsDb.getProjectById(first.project.projectId);
      assert.equal(archivedRow?.isArchived, 1);

      const restored = await descendIntoChild(workspaceProject.project_id, repoA);
      assert.equal(restored.created, false);
      assert.equal(restored.project.isArchived, false);
    });
  });
});

test('descendIntoChild: promotes a row the session indexer only discovered', async () => {
  await withDatabase(async () => {
    await withWorkspaceFixture(async ({ workspaceDir, repoA }) => {
      const workspaceProject = projectsDb.createProjectPath(workspaceDir).project;
      assert.ok(workspaceProject);
      projectsDb.ensureProjectPathForSession(repoA);
      assert.equal(projectsDb.getProjectPath(repoA)?.origin, 'auto');

      const result = await descendIntoChild(workspaceProject.project_id, repoA);
      assert.equal(result.created, false);
      assert.equal(result.project.origin, 'explicit');
      assert.equal(projectsDb.getProjectPath(repoA)?.origin, 'explicit');
    });
  });
});

test('descendIntoChild: rejects non-child paths, non-git children, and traversal', async () => {
  await withDatabase(async () => {
    await withWorkspaceFixture(async ({ workspaceDir, repoA }) => {
      const workspaceProject = projectsDb.createProjectPath(workspaceDir).project;
      assert.ok(workspaceProject);

      const outsideDir = await mkdtemp(path.join(tmpdir(), 'gajae-outside-'));
      try {
        await assert.rejects(
          () => descendIntoChild(workspaceProject.project_id, outsideDir),
          (error: unknown) => code(error) === 'NOT_WORKSPACE_CHILD' && statusCode(error) === 400,
        );

        await assert.rejects(
          () => descendIntoChild(workspaceProject.project_id, path.join(workspaceDir, 'plain-dir')),
          (error: unknown) => code(error) === 'NOT_WORKSPACE_CHILD' && statusCode(error) === 400,
        );

        await assert.rejects(
          () => descendIntoChild(workspaceProject.project_id, path.join(repoA, '..', '..')),
          (error: unknown) => code(error) === 'NOT_WORKSPACE_CHILD' && statusCode(error) === 400,
        );
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }

      const nonWorkspaceProject = projectsDb.createProjectPath(repoA).project;
      assert.ok(nonWorkspaceProject);
      await assert.rejects(
        () => descendIntoChild(nonWorkspaceProject.project_id, repoA),
        (error: unknown) => code(error) === 'NOT_WORKSPACE_CHILD' && statusCode(error) === 400,
      );
    });
  });
});
