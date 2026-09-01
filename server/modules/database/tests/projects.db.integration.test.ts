import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, getConnection, getDatabasePath } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';

async function inProjectRepository(action: () => void | Promise<void>): Promise<void> {
  const originalDatabasePath = process.env.DATABASE_PATH;
  const repositoryDirectory = await mkdtemp(path.join(tmpdir(), 'gajae-project-repository-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(repositoryDirectory, 'projects.sqlite');
  try {
    await initializeDatabase();
    await action();
  } finally {
    closeConnection();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    await rm(repositoryDirectory, { recursive: true, force: true });
  }
}

function insertLegacyProject(projectId: string, projectPath: string): void {
  getConnection().prepare(`
    INSERT INTO projects (project_id, project_path, custom_project_name, isArchived)
    VALUES (?, ?, ?, 0)
  `).run(projectId, projectPath, 'Migrated Gajae project');
}

test('explicit project registration distinguishes a new path, an archived path, and an active duplicate', async () => {
  await inProjectRepository(() => {
    const newPath = '/workspaces/gajae/desktop';
    const archivedPath = '/workspaces/gajae/archive';
    const created = projectsDb.createProjectPath(newPath);

    assert.deepEqual(
      created.project && {
        outcome: created.outcome,
        path: created.project.project_path,
        archived: created.project.isArchived,
        origin: created.project.origin,
      },
      { outcome: 'created', path: newPath, archived: 0, origin: 'explicit' },
    );

    const archived = projectsDb.createProjectPath(archivedPath, 'Gajae archive');
    assert.equal(archived.outcome, 'created');
    assert.ok(archived.project);
    projectsDb.updateProjectIsArchived(archivedPath, true);
    const reactivated = projectsDb.createProjectPath(archivedPath, 'Gajae archive restored');
    assert.deepEqual(
      reactivated.project && {
        outcome: reactivated.outcome,
        projectId: reactivated.project.project_id,
        archived: reactivated.project.isArchived,
      },
      { outcome: 'reactivated_archived', projectId: archived.project.project_id, archived: 0 },
    );

    const duplicate = projectsDb.createProjectPath(newPath);
    assert.deepEqual(
      duplicate.project && {
        outcome: duplicate.outcome,
        projectId: duplicate.project.project_id,
        archived: duplicate.project.isArchived,
        origin: duplicate.project.origin,
      },
      { outcome: 'active_conflict', projectId: created.project?.project_id, archived: 0, origin: 'explicit' },
    );
  });
});

test('session discovery creates auto origins without overwriting explicit or legacy ownership', async () => {
  await inProjectRepository(() => {
    const paths = {
      automatic: '/workspaces/gajae/watcher-created',
      explicit: '/workspaces/gajae/user-created',
      legacy: '/workspaces/gajae/migrated',
    };

    projectsDb.ensureProjectPathForSession(paths.automatic);
    const explicit = projectsDb.createProjectPath(paths.explicit);
    projectsDb.ensureProjectPathForSession(paths.explicit);
    insertLegacyProject('legacy-gajae-migrated', paths.legacy);
    projectsDb.ensureProjectPathForSession(paths.legacy);

    assert.equal(projectsDb.getProjectPath(paths.automatic)?.origin, 'auto');
    assert.equal(explicit.outcome, 'created');
    assert.equal(projectsDb.getProjectPath(paths.explicit)?.origin, 'explicit');
    assert.equal(projectsDb.getProjectPath(paths.legacy)?.origin, 'legacy');

    const legacyDuplicate = projectsDb.createProjectPath(paths.legacy);
    assert.deepEqual(
      legacyDuplicate.project && { outcome: legacyDuplicate.outcome, origin: legacyDuplicate.project.origin },
      { outcome: 'active_conflict', origin: 'legacy' },
    );
  });
});

test('explicit actions reactivate automatic projects and promote origins without changing promotion archival state', async () => {
  await inProjectRepository(() => {
    const archivedAutoPath = '/workspaces/gajae/archived-watcher-project';
    projectsDb.ensureProjectPathForSession(archivedAutoPath);
    projectsDb.updateProjectIsArchived(archivedAutoPath, true);
    const reactivated = projectsDb.createProjectPath(archivedAutoPath);
    assert.deepEqual(
      reactivated.project && {
        outcome: reactivated.outcome,
        archived: reactivated.project.isArchived,
        origin: reactivated.project.origin,
      },
      { outcome: 'reactivated_archived', archived: 0, origin: 'explicit' },
    );

    const activeAutoPath = '/workspaces/gajae/active-watcher-project';
    projectsDb.ensureProjectPathForSession(activeAutoPath);
    const automatic = projectsDb.getProjectPath(activeAutoPath);
    assert.ok(automatic);
    projectsDb.updateProjectIsArchivedById(automatic.project_id, true);

    insertLegacyProject('legacy-gajae-promote', '/workspaces/gajae/legacy-promote');
    const promotions = [
      projectsDb.promoteProjectOriginById(automatic.project_id),
      projectsDb.promoteProjectOriginById('legacy-gajae-promote'),
    ];
    assert.deepEqual(
      promotions.map((project) => project && { origin: project.origin, archived: project.isArchived }),
      [
        { origin: 'explicit', archived: 1 },
        { origin: 'explicit', archived: 0 },
      ],
    );
  });
});

test('the default application database path leaves the former cloud-cli location untouched', async () => {
  const originalDatabasePath = process.env.DATABASE_PATH;
  const originalHome = process.env.HOME;
  const temporaryHome = await mkdtemp(path.join(tmpdir(), 'gajae-project-home-'));
  const oldPath = path.join(temporaryHome, `.${['cloud', 'cli'].join('')}`, 'auth.db');
  const expectedPath = path.join(temporaryHome, '.gajae-app', 'auth.db');

  await mkdir(path.dirname(oldPath), { recursive: true });
  const oldDatabase = new Database(oldPath);
  oldDatabase.exec(`
    CREATE TABLE preserved_data (value TEXT NOT NULL);
    INSERT INTO preserved_data (value) VALUES ('old-root-data');
  `);
  oldDatabase.close();
  const oldBytes = await readFile(oldPath);

  closeConnection();
  process.env.HOME = temporaryHome;
  delete process.env.DATABASE_PATH;
  try {
    assert.equal(getDatabasePath(), expectedPath);
    await initializeDatabase();
    assert.equal((await stat(expectedPath)).isFile(), true);
    assert.deepEqual(await readFile(oldPath), oldBytes);

    const preserved = new Database(oldPath, { readonly: true });
    // This is a controlled fixture query with a single declared column.
    const preservedRow = preserved.prepare('SELECT value FROM preserved_data').get() as { value: string };
    assert.equal(preservedRow.value, 'old-root-data');
    preserved.close();
  } finally {
    closeConnection();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(temporaryHome, { recursive: true, force: true });
  }
});
