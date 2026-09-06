import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { closeConnection, initializeDatabase, projectPermissionsDb, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { resolveProjectRunPermissions } from '@/modules/projects/index.js';
import providerRoutes from '@/modules/providers/provider.routes.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { AppError } from '@/shared/utils.js';

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'session-project-binding-'));
  const previous = process.env.DATABASE_PATH;
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'app.db');
  await initializeDatabase();
  t.after(async () => {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const original = path.join(directory, 'project');
  await mkdir(original);
  const canonical = await realpath(original);
  const alias = path.join(directory, 'alias');
  await symlink(canonical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  projectsDb.createProjectPath(canonical);
  projectPermissionsDb.setMode(canonical, 'bypass', { acknowledgeBypass: true });
  return { directory, original, canonical, alias };
}

test('session creation binds directory aliases to the canonical project and its policy', async (t) => {
  const f = await fixture(t);
  for (const input of [f.original, f.alias, `${f.alias}${path.sep}`]) {
    const created = await sessionsService.createAppSession('gjc', input);
    const session = sessionsDb.getSessionById(created.sessionId);
    assert.equal(created.projectPath, f.canonical);
    assert.equal(session?.project_path, f.canonical);
    assert.equal(resolveProjectRunPermissions(session?.project_path).mode, 'bypass');
  }
  assert.equal(sessionsDb.countSessionsByProjectPath(f.canonical), 3);
  assert.deepEqual(projectsDb.getProjectPaths().map((p) => p.project_path), [f.canonical]);
  assert.equal(projectsDb.getProjectPath(f.alias), null);
});

test('POST sessions awaits canonical binding and returns the created identity', async (t) => {
  const f = await fixture(t);
  const server = express().use(express.json()).use('/api/providers', providerRoutes).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const { port } = server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${port}/api/providers/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gjc', projectPath: f.alias }),
  });
  assert.equal(response.status, 201);
  const { data } = await response.json() as { data: { sessionId: string; projectPath: string } };
  assert.ok(data.sessionId);
  assert.equal(data.projectPath, f.canonical);
  assert.equal(sessionsDb.countSessionsByProjectPath(f.canonical), 1);
});

test('unavailable paths and aliases into native worktrees fail before session persistence', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.directory, 'file');
  await writeFile(file, 'fixture');
  const managed = path.join(f.canonical, '.gjc-worktrees', 'job-fixture');
  await mkdir(managed, { recursive: true });
  const alias = path.join(f.directory, 'managed-alias');
  await symlink(managed, alias, process.platform === 'win32' ? 'junction' : 'dir');
  for (const input of [file, path.join(f.directory, 'missing'), managed, alias]) {
    await assert.rejects(sessionsService.createAppSession('gjc', input), (error: unknown) => error instanceof AppError && error.statusCode === 400);
  }
  assert.equal(sessionsDb.countSessionsByProjectPath(f.canonical), 0);
  assert.equal(projectsDb.getProjectPaths().length, 1);
});
