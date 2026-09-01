import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, getConnection, getDatabasePath } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';

async function withIsolatedDatabase(action: () => void | Promise<void>): Promise<void> {
  const inheritedPath = process.env.DATABASE_PATH;
  const workspace = await mkdtemp(path.join(tmpdir(), 'projects-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(workspace, 'auth.db');
  try {
    await initializeDatabase();
    await action();
  } finally {
    closeConnection();
    if (inheritedPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = inheritedPath;
    await rm(workspace, { recursive: true, force: true });
  }
}

function insertLegacyProject(projectId: string, projectPath: string): void {
  getConnection().prepare(`
    INSERT INTO projects (project_id, project_path, custom_project_name, isArchived)
    VALUES (?, ?, ?, 0)
  `).run(projectId, projectPath, 'Legacy Project');
}

test('explicit project creation distinguishes new, archived, and active paths', async () => {
  await withIsolatedDatabase(() => {
    const fresh = projectsDb.createProjectPath('/workspace/new-project');
    assert.equal(fresh.outcome, 'created');
    assert.equal(fresh.project?.project_path, '/workspace/new-project');
    assert.equal(fresh.project?.isArchived, 0);
    assert.equal(fresh.project?.origin, 'explicit');

    const archived = projectsDb.createProjectPath('/workspace/archived-project', 'Archived Project');
    assert.equal(archived.outcome, 'created');
    assert.ok(archived.project);
    projectsDb.updateProjectIsArchived('/workspace/archived-project', true);
    const restored = projectsDb.createProjectPath('/workspace/archived-project', 'Renamed Project');
    assert.equal(restored.outcome, 'reactivated_archived');
    assert.equal(restored.project?.project_id, archived.project.project_id);
    assert.equal(restored.project?.isArchived, 0);

    const conflict = projectsDb.createProjectPath('/workspace/new-project');
    assert.equal(conflict.outcome, 'active_conflict');
    assert.equal(conflict.project?.project_id, fresh.project?.project_id);
    assert.equal(conflict.project?.isArchived, 0);
    assert.equal(conflict.project?.origin, 'explicit');
  });
});

test('session-created projects are automatic without overwriting established origins', async () => {
  await withIsolatedDatabase(() => {
    projectsDb.ensureProjectPathForSession('/workspace/auto-project');
    assert.equal(projectsDb.getProjectPath('/workspace/auto-project')?.origin, 'auto');

    const explicit = projectsDb.createProjectPath('/workspace/explicit-project');
    assert.equal(explicit.outcome, 'created');
    projectsDb.ensureProjectPathForSession('/workspace/explicit-project');
    assert.equal(projectsDb.getProjectPath('/workspace/explicit-project')?.origin, 'explicit');

    insertLegacyProject('legacy-project-id', '/workspace/legacy-project');
    projectsDb.ensureProjectPathForSession('/workspace/legacy-project');
    assert.equal(projectsDb.getProjectPath('/workspace/legacy-project')?.origin, 'legacy');
    const conflict = projectsDb.createProjectPath('/workspace/legacy-project');
    assert.equal(conflict.outcome, 'active_conflict');
    assert.equal(conflict.project?.origin, 'legacy');
  });
});

test('explicit actions revive automatic projects and promote old origins without changing archival flags', async () => {
  await withIsolatedDatabase(() => {
    projectsDb.ensureProjectPathForSession('/workspace/archived-auto-project');
    projectsDb.updateProjectIsArchived('/workspace/archived-auto-project', true);
    const restored = projectsDb.createProjectPath('/workspace/archived-auto-project');
    assert.equal(restored.outcome, 'reactivated_archived');
    assert.equal(restored.project?.isArchived, 0);
    assert.equal(restored.project?.origin, 'explicit');

    projectsDb.ensureProjectPathForSession('/workspace/auto-project');
    const automatic = projectsDb.getProjectPath('/workspace/auto-project');
    assert.ok(automatic);
    projectsDb.updateProjectIsArchivedById(automatic.project_id, true);
    const promotedAuto = projectsDb.promoteProjectOriginById(automatic.project_id);
    assert.equal(promotedAuto?.origin, 'explicit');
    assert.equal(promotedAuto?.isArchived, 1);

    insertLegacyProject('legacy-project-id', '/workspace/legacy-project');
    const promotedLegacy = projectsDb.promoteProjectOriginById('legacy-project-id');
    assert.equal(promotedLegacy?.origin, 'explicit');
    assert.equal(promotedLegacy?.isArchived, 0);
  });
});

test('the default database location uses the gajae-app home without touching the prior root', async () => {
  const inheritedPath = process.env.DATABASE_PATH;
  const inheritedHome = process.env.HOME;
  const home = await mkdtemp(path.join(tmpdir(), 'projects-db-home-'));
  const oldPath = path.join(home, `.${['cloud', 'cli'].join('')}`, 'auth.db');
  const expectedPath = path.join(home, '.gajae-app', 'auth.db');

  await mkdir(path.dirname(oldPath), { recursive: true });
  const oldDatabase = new Database(oldPath);
  oldDatabase.exec(`
    CREATE TABLE preserved_data (value TEXT NOT NULL);
    INSERT INTO preserved_data (value) VALUES ('old-root-data');
  `);
  oldDatabase.close();
  const oldBytes = await readFile(oldPath);

  closeConnection();
  process.env.HOME = home;
  delete process.env.DATABASE_PATH;
  try {
    assert.equal(getDatabasePath(), expectedPath);
    await initializeDatabase();
    assert.equal((await stat(expectedPath)).isFile(), true);
    assert.deepEqual(await readFile(oldPath), oldBytes);

    const preserved = new Database(oldPath, { readonly: true });
    assert.equal((preserved.prepare('SELECT value FROM preserved_data').get() as { value: string }).value, 'old-root-data');
    preserved.close();
  } finally {
    closeConnection();
    if (inheritedPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = inheritedPath;
    if (inheritedHome === undefined) delete process.env.HOME;
    else process.env.HOME = inheritedHome;
    await rm(home, { recursive: true, force: true });
  }
});
