import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import type { Dir, Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import express, { type Request, type Response } from 'express';

import { asyncHandler, snapshotHttpActivity } from '../shared/utils.js';

import { fileTreeRequest, getFileTree, type ProjectFileNode } from './project-file-tree.js';

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'gajae-file-tree-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
function paths(nodes: ProjectFileNode[], parent = ''): string[] {
  return nodes.flatMap((node) => {
    const relative = parent + node.name;
    return [relative, ...paths(node.children ?? [], relative + '/')];
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

// Generate a wide directory lazily so the regression itself never allocates
// tens of thousands of fixtures/promises before the production walker sees it.
async function wideDirectory(t: TestContext, count: number, name = (i: number) => `file-${i}`) {
  const root = await fixture(t);
  const sample = await fs.lstat(root);
  let reads = 0;
  let stats = 0;
  let closed = 0;
  t.mock.method(fs, 'opendir', async () => ({
    async *[Symbol.asyncIterator]() {
      try {
        for (let i = 0; i < count; i++) {
          reads++;
          yield { name: name(i), isDirectory: () => false } as Dirent;
        }
      } finally { closed++; }
    },
  }) as Dir);
  t.mock.method(fs, 'lstat', async () => { stats++; return sample; });
  return { root, counts: () => ({ reads, stats, closed }) };
}

test('tree preserves metadata, sorting and dotfiles while excluding runtime scratch and worktrees', async (t) => {
  const root = await fixture(t);
  for (const dir of ['src/nested', 'node_modules/pkg', '.gjc/_session-one/runtime', '.gjc/skills/review', '.gjc-worktrees/job']) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(path.join(root, dir, 'file.txt'), 'hello');
  }
  await fs.writeFile(path.join(root, '.env.example'), 'x');
  await fs.writeFile(path.join(root, 'z.txt'), 'hello');
  await fs.chmod(path.join(root, 'z.txt'), 0o640);
  await fs.symlink(path.join(root, 'src'), path.join(root, 'linked-src'));
  const tree = await getFileTree(root, { maxDepth: 10 });
  assert.deepEqual(paths(tree), [
    '.gjc', '.gjc/skills', '.gjc/skills/review', '.gjc/skills/review/file.txt',
    'src', 'src/nested', 'src/nested/file.txt', '.env.example', 'linked-src', 'z.txt',
  ]);
  const file = tree.find((node) => node.name === 'z.txt')!;
  assert.equal(file.size, 5);
  assert.equal(file.permissions, '640');
  assert.equal(file.permissionsRwx, 'rw-r-----');
  assert.ok(file.modified && !Number.isNaN(Date.parse(file.modified)));
  assert.equal(file.path, path.join(root, 'z.txt'));
  const link = tree.find((node) => node.name === 'linked-src')!;
  assert.equal(link.isSymlink, true);
  assert.equal(link.children, undefined);
});

test('filesystem suggestions enumerate immediate directories without reading their contents', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'project/child'), { recursive: true });
  await fs.mkdir(path.join(root, '.hidden'));
  await fs.writeFile(path.join(root, 'README.md'), 'x');
  const open = t.mock.method(fs, 'opendir');
  const stats = t.mock.method(fs, 'lstat');
  // The folder browser owns the show-hidden toggle, so hidden directories stay
  // in the listing; only files and every directory's contents are skipped.
  const tree = await getFileTree(root, { maxDepth: 0, directoriesOnly: true });
  assert.deepEqual(paths(tree), ['.hidden', 'project']);
  assert.equal(tree.find((node) => node.name === 'project')!.children, undefined);
  assert.equal(open.mock.callCount(), 1);
  assert.deepEqual(stats.mock.calls.map((call) => String(call.arguments[0])).sort(),
    [path.join(root, '.hidden'), path.join(root, 'project')].sort());
  assert.deepEqual(paths(await getFileTree(root, { maxDepth: 0, showHidden: false, directoriesOnly: true })), ['project']);
});

test('wide directories fail with 413 without reading or scheduling the remaining entries', async (t) => {
  const wide = await wideDirectory(t, 1_000_000);
  await assert.rejects(getFileTree(wide.root), { code: 'FILE_TREE_TOO_LARGE', statusCode: 413 });
  assert.deepEqual(wide.counts(), { reads: 20_001, stats: 20_000, closed: 1 });
  // A failed scan releases admission too.
  for (let i = 0; i < 5; i++) {
    await assert.rejects(getFileTree(wide.root), { code: 'FILE_TREE_TOO_LARGE' });
  }
});

test('escaped multibyte paths hit the byte budget before the entry budget', async (t) => {
  const wide = await wideDirectory(t, 20_000, (i) => '한'.repeat(80) + i);
  await assert.rejects(getFileTree(wide.root), { code: 'FILE_TREE_TOO_LARGE', statusCode: 413 });
  assert.ok(wide.counts().reads < 20_000);
  assert.equal(wide.counts().closed, 1);
});

test('scan timeout closes directory iteration and releases admission', async (t) => {
  const wide = await wideDirectory(t, 1);
  let clock = 0;
  t.mock.method(Date, 'now', () => { clock += 5_000; return clock; });
  for (let i = 0; i < 5; i++) {
    await assert.rejects(getFileTree(wide.root), { code: 'FILE_TREE_TIMEOUT', statusCode: 503 });
  }
  assert.equal(wide.counts().closed, 5);
});

test('missing paths remain empty and recursive scans close every handle on cancellation', async (t) => {
  const root = await fixture(t);
  assert.deepEqual(await getFileTree(path.join(root, 'missing')), []);
  await fs.mkdir(path.join(root, 'child'));
  await fs.writeFile(path.join(root, 'child/file.txt'), 'x');
  const realOpen = fs.opendir;
  const realStat = fs.lstat;
  const handles: Dir[] = [];
  t.mock.method(fs, 'opendir', async (...args: Parameters<typeof fs.opendir>) => {
    const dir = await realOpen(...args); handles.push(dir); return dir;
  });
  const controller = new AbortController();
  t.mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) => {
    const stats = await realStat(...args);
    if (String(args[0]).endsWith('file.txt')) controller.abort();
    return stats;
  });
  await assert.rejects(getFileTree(root, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(handles.length, 2);
  for (const handle of handles) await assert.rejects(handle.read(), { code: 'ERR_DIR_CLOSED' });
  const count = handles.length;
  await assert.rejects(getFileTree(root, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(handles.length, count);
});

test('concurrent callers cannot create an unbounded scan queue', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'file.txt'), 'x');
  const started = deferred();
  const release = deferred();
  t.after(() => release.resolve());
  const realStat = fs.lstat;
  let statsStarted = 0;
  t.mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) => {
    if (++statsStarted === 4) started.resolve();
    await release.promise;
    return realStat(...args);
  });
  const controller = new AbortController();
  const running = Array.from({ length: 4 }, () => getFileTree(root, { signal: controller.signal }));
  const settled = Promise.allSettled(running);
  await started.promise;
  await assert.rejects(getFileTree(root), { code: 'FILE_TREE_BUSY', statusCode: 503 });
  controller.abort();
  // A pending disk call is still owned even after abort.
  await assert.rejects(getFileTree(root), { code: 'FILE_TREE_BUSY' });
  release.resolve();
  assert.ok((await settled).every((result) => result.status === 'rejected'));
  assert.deepEqual(paths(await getFileTree(root)), ['file.txt']);
});

test('normal incoming GET completion is not cancellation; response close is', () => {
  const req = new EventEmitter() as Request;
  const res = new EventEmitter() as Response;
  const listing = fileTreeRequest(req, res);
  req.emit('close');
  assert.equal(listing.signal.aborted, false);
  res.emit('close');
  assert.equal(listing.signal.aborted, true);
  listing.dispose();
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});

test('HTTP disconnect cancels enumeration but holds handler ownership until disk work settles', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'file.txt'), 'x');
  const started = deferred();
  const release = deferred();
  const cancelled = deferred();
  const completed = deferred();
  const realStat = fs.lstat;
  t.mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) => {
    started.resolve(); await release.promise; return realStat(...args);
  });
  const app = express();
  const initial = snapshotHttpActivity().running;
  app.get('/files', asyncHandler(async (req, res) => {
    const listing = fileTreeRequest(req, res);
    listing.signal.addEventListener('abort', () => cancelled.resolve(), { once: true });
    try { res.json(await getFileTree(root, { signal: listing.signal })); }
    catch (error) { if (!listing.signal.aborted) throw error; }
    finally { listing.dispose(); completed.resolve(); }
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { release.resolve(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const client = http.get(`http://127.0.0.1:${address.port}/files`);
  client.on('error', () => {});
  await started.promise;
  client.destroy();
  await cancelled.promise;
  assert.equal(snapshotHttpActivity().running, initial + 1);
  release.resolve();
  await completed.promise; await tick();
  assert.equal(snapshotHttpActivity().running, initial);
});
