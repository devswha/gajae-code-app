import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import { isManagedWorktreePath, projectsDb } from '@/modules/database/repositories/projects.db.js';

let directory: string;

after(async () => {
  closeConnection();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('isManagedWorktreePath matches only real .gjc-worktrees path segments', () => {
  assert.equal(isManagedWorktreePath('/repo/.gjc-worktrees/job-1'), true);
  assert.equal(isManagedWorktreePath('/repo/.gjc-worktrees'), true);
  assert.equal(isManagedWorktreePath('/repo/nested/.gjc-worktrees/job-2/src'), true);
  assert.equal(isManagedWorktreePath('/repo'), false);
  assert.equal(isManagedWorktreePath('/repo/my.gjc-worktrees-notes'), false);
  assert.equal(isManagedWorktreePath('/repo/gjc-worktrees'), false);
});

test('managed worktree rows satisfy the FK but never surface in project listings', async () => {
  closeConnection();
  directory = await mkdtemp(join(tmpdir(), 'projects-worktree-'));
  process.env.DATABASE_PATH = join(directory, 'auth.db');
  await initializeDatabase();

  projectsDb.createProjectPath('/home/user/real-project');
  projectsDb.createProjectPath('/home/user/real-project/.gjc-worktrees/job-abc');
  projectsDb.createProjectPath('/home/user/archived-project');
  projectsDb.updateProjectIsArchived('/home/user/archived-project', true);
  projectsDb.createProjectPath('/home/user/other/.gjc-worktrees/job-def');
  projectsDb.updateProjectIsArchived('/home/user/other/.gjc-worktrees/job-def', true);

  // The rows exist for the sessions foreign key…
  assert.ok(projectsDb.getProjectPath('/home/user/real-project/.gjc-worktrees/job-abc'));

  // …but neither the active nor the archived listing exposes them.
  const active = projectsDb.getProjectPaths().map((row) => row.project_path);
  assert.deepEqual(active, ['/home/user/real-project']);
  const archived = projectsDb.getArchivedProjectPaths().map((row) => row.project_path);
  assert.deepEqual(archived, ['/home/user/archived-project']);
});

test('session-sync ensure never reactivates an archived project', () => {
  projectsDb.createProjectPath('/home/user/parked-project');
  projectsDb.updateProjectIsArchived('/home/user/parked-project', true);

  // Background sync keeps landing sessions in the archived directory…
  projectsDb.ensureProjectPathForSession('/home/user/parked-project');
  assert.equal(projectsDb.getProjectPath('/home/user/parked-project')?.isArchived, 1);
  assert.equal(projectsDb.getProjectPath('/home/user/parked-project')?.origin, 'explicit');

  // …while a genuinely new directory still gets an active row.
  projectsDb.ensureProjectPathForSession('/home/user/fresh-project');
  assert.equal(projectsDb.getProjectPath('/home/user/fresh-project')?.isArchived, 0);
  assert.equal(projectsDb.getProjectPath('/home/user/fresh-project')?.origin, 'auto');

  // The user-facing create path intentionally keeps its reactivation contract.
  const reactivated = projectsDb.createProjectPath('/home/user/parked-project');
  assert.equal(reactivated.outcome, 'reactivated_archived');
});
