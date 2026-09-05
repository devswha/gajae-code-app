import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { appImagePlugin, restoreAppImageRuntime, restoreLinuxAppImage } from './restore-linux-appimage.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-appimage-restore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ productName: 'Gajae Code App', desktopVersion: '0.2.2' }));
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
  return { root, appDir, payload, native, source, sidecar, bundledNode, manifest };
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
  assert.equal(await readFile(path.join(f.payload, f.native), 'utf8'), 'linuxdeploy changed RPATH');
  assert.equal(await readFile(f.bundledNode, 'utf8'), 'patched Node');
});

test('missing original runtime files fail before replacing the deployed payload', async t => {
  for (const input of ['sidecar', 'bun', 'manifest']) {
    await t.test(input, async t => {
      const f = await fixture(t);
      const source = input === 'sidecar' ? f.sidecar : path.join(f.source, input === 'bun' ? 'dist-native/bun' : 'server/gjc-runtime-manifest.json');
      await rm(source);
      await assert.rejects(restoreAppImageRuntime(f.appDir, { payloadDir: f.source, sidecarPath: f.sidecar }), { code: 'ENOENT' });
      assert.equal(await readFile(f.bundledNode, 'utf8'), 'patched Node');
      assert.equal(await readFile(path.join(f.payload, 'dist-native/bun'), 'utf8'), 'stripped Bun');
    });
  }
});

async function executable(file, script) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `#!${process.execPath}\n${script}`, { mode: 0o755 });
}

test('AppImage tool discovery handles local tools, non-executable candidates and missing tools', async t => {
  const f = await fixture(t);
  const env = { XDG_CACHE_HOME: path.join(f.root, 'cache'), TAURI_BUNDLER_TOOLS_CACHE_DIR: path.join(f.root, 'override') };
  const targetDir = path.join(f.root, 'target');
  const unusable = path.join(env.TAURI_BUNDLER_TOOLS_CACHE_DIR, 'linuxdeploy-plugin-appimage.AppImage');
  await executable(unusable, '');
  await chmod(unusable, 0o644);
  const local = path.join(targetDir, '.tauri/linuxdeploy-plugin-appimage.AppImage');
  await executable(local, '');
  const plugin = await appImagePlugin({ targetDir, env });
  assert.equal(plugin.command, local);
  assert.deepEqual(plugin.args, ['--appimage-extract-and-run']);
  await plugin.cleanup();
  await rm(local);
  await assert.rejects(appImagePlugin({ targetDir, env }), /output plugin was not found/);
});

test('optional plugin download can fall back to linuxdeploy built-in plugin and cleans extraction', async t => {
  const f = await fixture(t);
  const targetDir = path.join(f.root, 'target');
  const env = { XDG_CACHE_HOME: path.join(f.root, 'cache'), EXTRACT_LOG: path.join(f.root, 'extraction.txt') };
  await executable(path.join(targetDir, '.tauri/linuxdeploy-x86_64.AppImage'), `
    const fs = require('node:fs');
    const path = require('node:path');
    if (process.argv[2] !== '--appimage-extract') process.exit(8);
    fs.writeFileSync(process.env.EXTRACT_LOG, process.cwd());
    const plugin = path.join(process.cwd(), 'squashfs-root/usr/bin/linuxdeploy-plugin-appimage');
    fs.mkdirSync(path.dirname(plugin), { recursive: true });
    fs.writeFileSync(plugin, '#!/bin/sh\\nexit 0\\n', { mode: 0o755 });
  `);
  const plugin = await appImagePlugin({ targetDir, env });
  const temporary = await readFile(env.EXTRACT_LOG, 'utf8');
  assert.equal(plugin.command, path.join(temporary, 'squashfs-root/usr/bin/linuxdeploy-plugin-appimage'));
  assert.deepEqual(plugin.args, []);
  await plugin.cleanup();
  await assert.rejects(stat(temporary), { code: 'ENOENT' });
  // Failed extraction must not leave the tool's private temporary directory.
  await executable(path.join(targetDir, '.tauri/linuxdeploy-x86_64.AppImage'), `
    require('node:fs').writeFileSync(process.env.EXTRACT_LOG, process.cwd()); process.exit(9);
  `);
  await assert.rejects(appImagePlugin({ targetDir, env }), /exited with code 9/);
  await assert.rejects(stat(await readFile(env.EXTRACT_LOG, 'utf8')), { code: 'ENOENT' });
});

test('recompression uses configured Cargo output, keeps original artifacts on failure and removes temporary output', {
  skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async t => {
  for (const outcome of ['success', 'failure', 'empty', 'missing AppImage', 'ambiguous AppDir', 'ambiguous AppImage', 'foreign AppDir', 'foreign AppImage']) {
    await t.test(outcome, async t => {
      const f = await fixture(t);
      const targetDir = path.join(f.root, 'configured target');
      const directory = path.join(targetDir, 'x86_64-unknown-linux-gnu/release/bundle/appimage');
      await mkdir(directory, { recursive: true });
      await rename(f.appDir, path.join(directory, path.basename(f.appDir)));
      let original = path.join(directory, 'Gajae Code App_0.2.2_amd64.AppImage');
      await writeFile(original, 'original AppImage', { mode: 0o755 });
      await mkdir(path.join(f.root, 'src-tauri/resources'), { recursive: true });
      await cp(f.source, path.join(f.root, 'src-tauri/resources/server-payload'), { recursive: true, verbatimSymlinks: true });
      const sidecar = path.join(f.root, 'src-tauri/binaries/gajae-app-server-x86_64-unknown-linux-gnu');
      await mkdir(path.dirname(sidecar), { recursive: true });
      await cp(f.sidecar, sidecar);
      const env = { XDG_CACHE_HOME: path.join(f.root, 'cache'), OUTCOME: outcome, INVOCATION: path.join(f.root, 'invocation.json') };
      await executable(path.join(targetDir, '.tauri/linuxdeploy-plugin-appimage.AppImage'), `
        const fs = require('node:fs');
        fs.writeFileSync(process.env.INVOCATION, JSON.stringify({ args: process.argv.slice(2), arch: process.env.ARCH }));
        fs.writeFileSync(process.env.LDAI_OUTPUT, process.env.OUTCOME === 'empty' ? '' : 'restored AppImage');
        if (process.env.OUTCOME === 'failure') process.exit(7);
      `);
      if (outcome === 'missing AppImage') await rm(original);
      if (outcome === 'ambiguous AppDir') await mkdir(path.join(directory, 'old.AppDir'));
      if (outcome === 'ambiguous AppImage') await writeFile(path.join(directory, 'old.AppImage'), 'stale');
      if (outcome === 'foreign AppDir') await rename(path.join(directory, path.basename(f.appDir)), path.join(directory, 'Other App.AppDir'));
      if (outcome === 'foreign AppImage') {
        const foreign = path.join(directory, 'Other App_0.2.2_amd64.AppImage');
        await rename(original, foreign);
        original = foreign;
      }
      const pending = restoreLinuxAppImage(f.root, { targetDir, env });
      if (outcome === 'success') {
        await pending;
        assert.equal(await readFile(original, 'utf8'), 'restored AppImage');
        assert.equal((await stat(original)).mode & 0o777, 0o755);
        assert.deepEqual(JSON.parse(await readFile(env.INVOCATION, 'utf8')), {
          args: ['--appimage-extract-and-run', '--appdir', path.join(directory, path.basename(f.appDir))], arch: 'x86_64',
        });
      } else {
        await assert.rejects(pending, /exited with code 7|empty or invalid artifact|exactly one built AppDir and AppImage|Unexpected.*artifact/);
        if (outcome !== 'missing AppImage') assert.equal(await readFile(original, 'utf8'), 'original AppImage');
        if (outcome.startsWith('foreign')) {
          await assert.rejects(stat(env.INVOCATION), { code: 'ENOENT' });
          const appDir = outcome === 'foreign AppDir' ? 'Other App.AppDir' : path.basename(f.appDir);
          assert.equal(await readFile(path.join(directory, appDir, 'usr/bin/gajae-app-server'), 'utf8'), 'patched Node');
        }
      }
      assert.equal((await readdir(directory)).some(name => name.includes('.restored-')), false);
    });
  }
});
