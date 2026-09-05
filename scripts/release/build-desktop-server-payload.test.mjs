import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('a rejected Node archive cleans the download, incomplete payload and sidecar on Linux and Mac', async t => {
  for (const [platform, arch, target] of [['linux', 'x64', 'x86_64-unknown-linux-gnu'], ['darwin', 'arm64', 'aarch64-apple-darwin']]) {
    await t.test(platform, async t => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-payload-cleanup-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      await mkdir(path.join(root, 'scripts/release'), { recursive: true });
      for (const file of ['build-desktop-server-payload.mjs', 'desktop-platforms.mjs', 'desktop-prebuilds.mjs', 'distribution-exclusions.mjs', 'out-of-tree.mjs', 'packaged-server-paths.mjs']) {
        await copyFile(new URL(file, import.meta.url), path.join(root, 'scripts/release', file));
      }
      for (const directory of ['dist', 'dist-server', 'shared', 'public', 'tmp', 'src-tauri/binaries']) await mkdir(path.join(root, directory), { recursive: true });
      for (const file of ['package.json', 'package-lock.json', 'server/gjc-runtime-manifest.json', 'scripts/fix-node-pty.js', 'scripts/gajae-app-runtime.mjs', 'dist-native/bun', 'dist-native/gajae-core', 'LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md']) {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), '{}');
      }
      const sidecar = path.join(root, 'src-tauri/binaries', `gajae-app-server-${target}`);
      await writeFile(sidecar, 'previous sidecar');
      const preload = path.join(root, 'download.cjs');
      await writeFile(preload, `
        Object.defineProperty(process, 'platform', { value: process.env.TEST_PLATFORM });
        Object.defineProperty(process, 'arch', { value: process.env.TEST_ARCH });
        global.fetch = async () => ({ ok: true, body: [Buffer.from('corrupted archive')] });
      `);
      const result = spawnSync(process.execPath, ['--require', preload, path.join(root, 'scripts/release/build-desktop-server-payload.mjs')], {
        env: { ...process.env, TMPDIR: path.join(root, 'tmp'), TEST_PLATFORM: platform, TEST_ARCH: arch }, encoding: 'utf8',
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Pinned Node archive failed SHA-256 verification/);
      await assert.rejects(stat(path.join(root, 'src-tauri/resources/server-payload')), { code: 'ENOENT' });
      await assert.rejects(stat(sidecar), { code: 'ENOENT' });
      assert.deepEqual(await readdir(path.join(root, 'tmp')), []);
    });
  }
});
