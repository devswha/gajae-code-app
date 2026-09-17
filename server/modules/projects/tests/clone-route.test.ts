import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import type { AppError } from '@/shared/utils.js';
import projectRoutes from '@/modules/projects/projects.routes.js';
import { resetCloneProgressStreams } from '@/modules/projects/services/clone-progress-registry.service.js';

/*
 * Starting a clone used to be the same GET that streamed its progress. Desktop
 * auth cookies are SameSite=Lax, so a cross-site top-level navigation carried
 * them: any page the owner visited could start a clone of a URL it chose, into
 * a directory it chose, with a token it supplied. Starting is a POST now and
 * the stream is a read.
 */

type Server = {
  workspace: string;
  post: (path: string, body: unknown) => Promise<Response>;
  get: (path: string) => Promise<Response>;
  close: () => Promise<void>;
};

async function serve(t: test.TestContext): Promise<Server> {
  const directory = await mkdtemp(path.join(tmpdir(), 'clone-route-'));
  const previousDatabase = process.env.DATABASE_PATH;
  const previousRoot = process.env.WORKSPACES_ROOT;
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  process.env.WORKSPACES_ROOT = directory;
  await initializeDatabase();

  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => { (request as express.Request & { user?: { id: number } }).user = { id: 1 }; next(); });
  app.use('/api/projects', projectRoutes);
  // Mirrors the product's global AppError middleware so route failures are
  // asserted in the shape a client actually receives.
  app.use((error: AppError, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(error.statusCode ?? 500).json({ success: false, error: { code: error.code, message: error.message } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  t.after(async () => {
    resetCloneProgressStreams();
    closeConnection();
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabase;
    if (previousRoot === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = previousRoot;
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
    await rm(directory, { recursive: true, force: true });
  });
  return {
    workspace: directory,
    post: (route, body) => fetch(`http://127.0.0.1:${port}${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    get: (route) => fetch(`http://127.0.0.1:${port}${route}`),
    close: async () => { server.close(); },
  };
}

test('a clone cannot be started by a GET', async (t) => {
  const server = await serve(t);
  const response = await server.get('/api/projects/clone-progress?path=/tmp&githubUrl=https://github.com/o/r');
  assert.equal(response.status, 200);
  const body = await response.text();
  // The stream is a read: with no clone id it reports that and ends, and no
  // clone was started by asking.
  assert.match(body, /No clone is running for that id/);
});

test('clone URLs are restricted to https', async (t) => {
  const server = await serve(t);
  for (const githubUrl of [
    'file:///etc',
    'ssh://git@github.com/o/r',
    'ext::sh -c whoami',
    'http://github.com/o/r',
    '--upload-pack=touch /tmp/pwned',
    '',
  ]) {
    const response = await server.post('/api/projects/clone', { path: '/workspace', githubUrl });
    assert.equal(response.status, 400, githubUrl);
    assert.equal((await response.json() as { error?: { code?: string } }).error?.code, 'INVALID_GITHUB_URL', githubUrl);
  }
});

test('a started clone is observable by id and reports its failure once', async (t) => {
  const server = await serve(t);
  // An unreachable https origin: the clone starts, fails, and the stream
  // carries that failure to a reader that attached after it finished.
  const started = await server.post('/api/projects/clone', {
    path: server.workspace,
    githubUrl: 'https://127.0.0.1:1/owner/repository.git',
  });
  assert.equal(started.status, 202);
  const { data } = await started.json() as { data: { cloneId: string } };
  assert.match(data.cloneId, /^[0-9a-f-]{36}$/u);

  const stream = await server.get(`/api/projects/clone-progress?cloneId=${data.cloneId}`);
  const body = await stream.text();
  assert.match(body, /"type":"error"/);
});
