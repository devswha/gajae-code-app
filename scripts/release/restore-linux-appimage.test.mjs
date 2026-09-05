import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { restoreAppImageRuntime } from './restore-linux-appimage.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-appimage-restore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const appDir = path.join(root, 'Gajae Code App.AppDir');
  const payload = path.join(appDir, 'usr/lib/Gajae Code App/resources/server-payload');
  const native = 'node_modules/@gajae-code/natives-linux-x64/native/addon.node';
  for (const relative of ['dist-server/server/index.js', 'dist-native/bun', 'dist-native/gajae-core', native]) {
    await mkdir(path.dirname(path.join(source, relative)), { recursive: true });
    await writeFile(path.join(source, relative), `original ${relative}`, { mode: 0o755 });
  }
  const hash = createHash('sha256').update(await readFile(path.join(source, native))).digest('hex');
  const manifest = { platforms: { 'linux-x64': { files: [{ package: '@gajae-code/natives-linux-x64', path: 'native/addon.node', sha256: hash }] } } };
  await mkdir(path.join(source, 'server'));
  await writeFile(path.join(source, 'server/gjc-runtime-manifest.json'), JSON.stringify(manifest));
  await symlink('bun', path.join(source, 'dist-native/bun-alias'));
  await mkdir(path.dirname(payload), { recursive: true });
  await cp(source, payload, { recursive: true, verbatimSymlinks: true });
  const sidecar = path.join(root, 'node');
  const bundledNode = path.join(appDir, 'usr/bin/gajae-app-server');
  await mkdir(path.dirname(bundledNode), { recursive: true });
  await writeFile(sidecar, 'original Node', { mode: 0o755 });
  await writeFile(bundledNode, 'patched Node', { mode: 0o755 });
  await writeFile(path.join(appDir, 'usr/lib/libgtk-3.so.0'), 'deployed GTK');
  await writeFile(path.join(payload, native), 'linuxdeploy changed RPATH');
  await writeFile(path.join(payload, 'dist-native/bun'), 'stripped Bun');
  await chmod(path.join(payload, 'dist-native/bun'), 0o755);
  await writeFile(path.join(payload, 'stale-native-file'), 'must not survive');
  return { appDir, payload, native, source, sidecar, bundledNode, manifest };
}

test('AppImage runtime restoration preserves manifest hashes, executable runtimes, symlinks and deployed GTK', async t => {
  const f = await fixture(t);
  await restoreAppImageRuntime(f.appDir, { payloadDir: f.source, sidecarPath: f.sidecar });
  assert.deepEqual(await readFile(path.join(f.payload, f.native)), await readFile(path.join(f.source, f.native)));
  assert.equal(await readFile(f.bundledNode, 'utf8'), 'original Node');
  assert.equal(await readFile(path.join(f.appDir, 'usr/lib/libgtk-3.so.0'), 'utf8'), 'deployed GTK');
  assert.equal(await readFile(path.join(f.payload, 'dist-native/bun-alias'), 'utf8'), 'original dist-native/bun');
  await assert.rejects(readFile(path.join(f.payload, 'stale-native-file')), { code: 'ENOENT' });
});

test('AppImage restoration rejects a source native file that no longer matches its pinned manifest', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.source, f.native), 'tampered source');
  await assert.rejects(restoreAppImageRuntime(f.appDir, { payloadDir: f.source, sidecarPath: f.sidecar }), /native hash mismatch/);
});
