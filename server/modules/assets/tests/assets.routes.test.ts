import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import express from 'express';

import assetsRouter from '../assets.routes.js';

async function serve(t: TestContext) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'gajae-assets-http-'));
  t.mock.method(os, 'homedir', () => home);
  const assets = path.join(home, '.gajae-app', 'assets');
  await mkdir(assets, { recursive: true });
  const app = express();
  app.use('/assets', assetsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  });
  return {
    home,
    assets,
    request: (url: string, options?: RequestInit) => fetch(`http://127.0.0.1:${address.port}/assets${url}`, options),
  };
}

test('an image MIME cannot turn an HTML filename into an active same-origin document', async (t) => {
  const server = await serve(t);
  const form = new FormData();
  form.append('images', new Blob(['<script>globalThis.compromised = true</script>'], { type: 'image/png' }), 'attack.html');
  const uploaded = await server.request('/images', { method: 'POST', body: form });
  assert.equal(uploaded.status, 200);
  const { images } = await uploaded.json() as { images: Array<{ path: string; name: string }> };
  assert.equal(images[0].name, 'attack.html');
  const downloaded = await server.request(`/images/${path.basename(images[0].path)}`);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'image/png');
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
  await downloaded.arrayBuffer();
});

test('legacy non-image assets and SVGs are downloaded without an active document type', async (t) => {
  const server = await serve(t);
  for (const filename of ['legacy.html', 'legacy.xml', 'legacy.svg']) {
    await writeFile(path.join(server.assets, filename), '<script>active content</script>');
    const response = await server.request(`/images/${filename}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), 'attachment', filename);
    assert.equal(response.headers.get('content-type'), filename.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
    await response.arrayBuffer();
  }
});

test('asset reads reject symlinks, directories, and encoded traversal without exposing outside files', async (t) => {
  const server = await serve(t);
  const secret = path.join(server.home, 'private.txt');
  await writeFile(secret, 'fixture-private-content');
  await symlink(secret, path.join(server.assets, 'linked.png'));
  await mkdir(path.join(server.assets, 'directory.png'));
  for (const filename of ['linked.png', 'directory.png', '%2e%2e%2fprivate.txt', '%00.png']) {
    const response = await server.request(`/images/${filename}`);
    assert.ok(response.status >= 400 && response.status < 500, `${filename}: ${response.status}`);
    assert.equal((await response.text()).includes('fixture-private-content'), false);
  }
});

test('ordinary uploaded PNGs remain retrievable with their exact bytes', async (t) => {
  const server = await serve(t);
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  const form = new FormData();
  form.append('images', new Blob([bytes], { type: 'image/png' }), 'picture.png');
  const uploaded = await server.request('/images', { method: 'POST', body: form });
  assert.equal(uploaded.status, 200);
  const { images } = await uploaded.json() as { images: Array<{ path: string }> };
  const downloaded = await server.request(`/images/${path.basename(images[0].path)}`);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
});
