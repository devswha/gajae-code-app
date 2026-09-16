import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { archiveProject, restoreArchivedProject } from '@/modules/projects/services/project-archive.service.js';
import { AppError } from '@/shared/utils.js';

/*
 * Removing a project from the sidebar.
 *
 * The row's only removal is archiving, and archiving is a flag. Nothing here may
 * touch a session row or a transcript on disk: a workspace the user hid must come
 * back from the archive screen exactly as it was.
 */

type Workspace = { projectId: string; projectPath: string; transcriptPath: string };

async function withWorkspace(action: (workspace: Workspace) => Promise<void>): Promise<void> {
  const previousDatabase = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'project-archive-'));
  const projectPath = path.join(directory, 'workspace');
  const transcriptPath = path.join(directory, 'session.jsonl');
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'app.sqlite');
  try {
    await initializeDatabase();
    await writeFile(transcriptPath, '{"role":"user","content":"keep me"}\n', 'utf8');
    const created = projectsDb.createProjectPath(projectPath);
    assert.ok(created.project);
    sessionsDb.createSession('session-1', 'gjc', projectPath, 'Fix the parser', undefined, undefined, transcriptPath);
    await action({ projectId: created.project.project_id, projectPath: created.project.project_path, transcriptPath });
  } finally {
    closeConnection();
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabase;
    await rm(directory, { recursive: true, force: true });
  }
}

test('archiving hides the workspace and keeps its sessions and transcripts', async () => {
  await withWorkspace(async ({ projectId, projectPath, transcriptPath }) => {
    archiveProject(projectId);

    assert.equal(projectsDb.getProjectById(projectId)?.isArchived, 1);
    assert.deepEqual(
      projectsDb.getProjectPaths().map((row) => row.project_id),
      [],
      'an archived workspace leaves the active list',
    );
    assert.deepEqual(
      projectsDb.getArchivedProjectPaths().map((row) => row.project_id),
      [projectId],
      'and shows up in the archive instead',
    );
    assert.equal(sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath).length, 1);
    assert.equal(await readFile(transcriptPath, 'utf8'), '{"role":"user","content":"keep me"}\n');
  });
});

test('restoring returns the workspace with everything it had', async () => {
  await withWorkspace(async ({ projectId, projectPath }) => {
    archiveProject(projectId);
    restoreArchivedProject(projectId);

    assert.equal(projectsDb.getProjectById(projectId)?.isArchived, 0);
    assert.deepEqual(projectsDb.getProjectPaths().map((row) => row.project_id), [projectId]);
    assert.equal(sessionsDb.getSessionsByProjectPath(projectPath).length, 1);
  });
});

test('an unknown project is a 404 rather than a silent no-op', async () => {
  await withWorkspace(async () => {
    for (const action of [() => archiveProject('missing-project'), () => restoreArchivedProject('missing-project')]) {
      assert.throws(action, (error: unknown) =>
        error instanceof AppError && error.code === 'PROJECT_NOT_FOUND' && error.statusCode === 404,
      );
    }
  });
});

test('no project route, service or repository can delete a project or its files', async () => {
  const routes = await readFile('server/modules/projects/projects.routes.ts', 'utf8');
  assert.equal(/router\.delete\('\/:projectId'/.test(routes), false, 'the workspace delete route is gone');
  assert.ok(routes.includes("router.post('/:projectId/archive'"), 'archiving replaced it');
  assert.equal(routes.includes('force'), false, 'and it carries no force escape hatch');

  const service = await readFile('server/modules/projects/services/project-archive.service.ts', 'utf8');
  assert.equal(/unlink|rm\b|rmdir/.test(service), false, 'archiving never reaches the filesystem');

  const repository = await readFile('server/modules/database/repositories/projects.db.ts', 'utf8');
  assert.equal(/DELETE FROM projects/.test(repository), false, 'and no repository call drops a project row');
});
