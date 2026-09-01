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
