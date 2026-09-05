import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { createSystemRouter } from './system.js';

async function serve(opener) {
  const app = express();
  app.use(express.json());
  app.use('/api/system', createSystemRouter({ opener }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    postOpenFile: (body) => fetch(`http://127.0.0.1:${port}/api/system/open-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    postOpenUrl: (body) => fetch(`http://127.0.0.1:${port}/api/system/open-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    postBrowserUrl: (body) => fetch(`http://127.0.0.1:${port}/api/system/open-browser-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    postDebugBundle: (body) => fetch(`http://127.0.0.1:${port}/api/system/debug-bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

test('open-file rejects relative and non-string paths', async () => {
  const server = await serve(async () => {});
  try {
    for (const body of [{ path: 'relative/file.txt' }, { path: 42 }, {}]) {
      assert.equal((await server.postOpenFile(body)).status, 400);
    }
  } finally {
    await server.close();
  }
});

test('Workspace Browser opens HTTP and HTTPS pages but never arbitrary executable schemes', async () => {
  const opened = [];
  const server = await serve(async target => { opened.push(target); });
  try {
    for (const url of ['http://localhost:5173/preview', 'https://example.com/docs']) {
      assert.equal((await server.postBrowserUrl({ url })).status, 200);
    }
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,test', 'about:blank', 'https://', null, 'x'.repeat(5000)]) {
      assert.equal((await server.postBrowserUrl({ url })).status, 400);
    }
    assert.equal((await server.postOpenUrl({ url: 'http://localhost:5173/preview' })).status, 400);
    assert.deepEqual(opened, ['http://localhost:5173/preview', 'https://example.com/docs']);
  } finally {
    await server.close();
  }
});

test('open-file reports a missing file before invoking the opener', async () => {
  let opened = null;
  const server = await serve(async (target) => { opened = target; });
  try {
    const response = await server.postOpenFile({ path: path.join(tmpdir(), `gajae-missing-${Date.now()}`) });
    assert.equal(response.status, 404);
    assert.equal(opened, null);
  } finally {
    await server.close();
  }
});

test('open-file hands an existing absolute path to the opener', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gajae-open-file-'));
  const target = path.join(dir, 'note.txt');
  writeFileSync(target, 'hello');
  let opened = null;
  const server = await serve(async (file) => { opened = file; });
  try {
    const response = await server.postOpenFile({ path: target });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(opened, target);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('open-file surfaces opener failures as a 500', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gajae-open-file-'));
  const target = path.join(dir, 'note.txt');
  writeFileSync(target, 'hello');
  const server = await serve(async () => { throw new Error('no opener available'); });
  try {
    assert.equal((await server.postOpenFile({ path: target })).status, 500);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('open-url hands an https link to the OS opener and refuses everything else', async () => {
  const opened = [];
  const server = await serve(async (target) => { opened.push(target); });
  try {
    assert.equal((await server.postOpenUrl({ url: 'https://auth.example.com/oauth?code=1' })).status, 200);
    assert.deepEqual(opened, ['https://auth.example.com/oauth?code=1']);
    for (const url of ['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'x-apple.systempreferences:', 42, '']) {
      assert.equal((await server.postOpenUrl({ url })).status, 400, `${String(url)} must be refused`);
    }
    assert.equal(opened.length, 1);
  } finally {
    await server.close();
  }
});

test('debug-bundle carries the session row, the transcript tail and the log tails as text', async () => {
  const server = await serve(async () => {});
  try {
    const noSession = await server.postDebugBundle({ sessionId: 'no-such-session' });
    assert.equal(noSession.status, 200);
    const bundle = (await noSession.json()).bundle;
    assert.match(bundle, /# Gajae Code App debug bundle/);
    assert.match(bundle, /no session "no-such-session"/);
    assert.match(bundle, /## worker log tail/);
    assert.match(bundle, /## browser sidecar log tail/);
    assert.doesNotMatch(bundle, /undefined/);
  } finally {
    await server.close();
  }
});
