import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildLinuxDesktop } from './build-linux-desktop.mjs';

async function fixture(t, target = 'environment') {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-linux-build-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'gajae-app', productName: 'Gajae Code App' }));
  await mkdir(path.join(rootDir, 'src-tauri/src'), { recursive: true });
  await writeFile(path.join(rootDir, 'src-tauri/Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n');
  await writeFile(path.join(rootDir, 'src-tauri/src/main.rs'), 'fn main() {}');
  const targetDir = target === 'default' ? path.join(rootDir, 'src-tauri/target') : path.join(rootDir, 'configured');
  const output = path.join(targetDir, 'x86_64-unknown-linux-gnu', 'release');
  const stale = [
    'resources/server-payload/removed.node',
    'bundle/deb/Gajae Code App_0.1.0_amd64.deb',
    'bundle/deb/Gajae Code App_0.1.0_amd64/data/old.node',
    'bundle/appimage/Gajae Code App.AppDir/foreign.node',
    'bundle/appimage/Gajae Code App_0.1.0_amd64.AppImage',
    'bundle/appimage_deb/data/usr/lib/Gajae Code App/resources/server-payload/old.node',
    'bundle/appimage_deb/data/usr/bin/gajae-app-desktop',
    'bundle/appimage_deb/data/usr/bin/gajae-app-server',
    'bundle/appimage_deb/data/usr/share/applications/Gajae Code App.desktop',
    'bundle/appimage_deb/data/usr/share/icons/hicolor/256x256@2/apps/gajae-app-desktop.png',
  ];
  for (const relative of stale) {
    await mkdir(path.dirname(path.join(output, relative)), { recursive: true });
    await writeFile(path.join(output, relative), 'stale');
  }
  const inheritedEnv = { ...process.env, CI: '1' };
  delete inheritedEnv.CARGO_TARGET_DIR;
  delete inheritedEnv.CARGO_BUILD_TARGET_DIR;
  if (target === 'environment') inheritedEnv.CARGO_TARGET_DIR = '../configured';
  if (target === 'config') {
    await mkdir(path.join(rootDir, 'src-tauri/.cargo'));
    await writeFile(path.join(rootDir, 'src-tauri/.cargo/config.toml'), '[build]\ntarget-dir = "../configured"\n');
  }
  return { rootDir, output, stale, inheritedEnv };
}

test('Linux build clears stale configured bundle inputs and stops before staging on failure', {
  skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async t => {
  for (const failure of [null, 'payload', 'tauri', 'restore']) {
    await t.test(failure || 'success', async t => {
      const { rootDir, output, stale, inheritedEnv } = await fixture(t);
      const defaultOutput = path.join(rootDir, 'src-tauri/target/keep');
      await mkdir(path.dirname(defaultOutput), { recursive: true });
      await writeFile(defaultOutput, 'unrelated');
      const stages = [];
      const execute = async (command, args, options) => {
        const stage = command === 'npm' ? (args.includes('server:payload:linux') ? 'payload' : 'tauri')
          : args[0].includes('restore-linux') ? 'restore' : 'stage';
        stages.push(stage);
        assert.equal(options.env.CI, undefined);
        assert.equal(options.env.APPIMAGE_EXTRACT_AND_RUN, '1');
        assert.equal(options.cwd, rootDir);
        if (stage === 'tauri') {
          for (const relative of stale) await assert.rejects(readFile(path.join(output, relative)), { code: 'ENOENT' });
          assert.deepEqual(args.slice(-2), ['--', '--locked']);
        }
        if (stage === failure) throw new Error(`fixture ${failure} failed`);
      };
      const pending = buildLinuxDesktop({ rootDir, inheritedEnv, execute });
      if (failure) await assert.rejects(pending, new RegExp(`fixture ${failure} failed`));
      else await pending;
      const expected = ['payload', 'tauri', 'restore', 'stage'];
      assert.deepEqual(stages, failure ? expected.slice(0, expected.indexOf(failure) + 1) : expected);
      assert.equal(await readFile(defaultOutput, 'utf8'), 'unrelated');
      assert.equal(inheritedEnv.CI, '1');
      if (failure === 'payload') for (const relative of stale) assert.equal(await readFile(path.join(output, relative), 'utf8'), 'stale');
    });
  }
});

test('a shared Cargo bundle with unrelated files is refused before payload build or cleanup', {
  skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async t => {
  for (const relative of [
    'other-app-sentinel', 'deb/Other App_1.0.0_amd64.deb',
    'appimage/Other App.AppDir/keep', 'appimage_deb/data/usr/lib/Other App/keep',
    'appimage_deb/data/usr/bin/other-app',
    'appimage_deb/data/usr/share/icons/hicolor/256x256@2/apps/other-app.png',
  ]) {
    await t.test(relative, async t => {
      const f = await fixture(t);
      const sentinel = path.join(f.output, 'bundle', relative);
      await mkdir(path.dirname(sentinel), { recursive: true });
      await writeFile(sentinel, 'other app must survive');
      const calls = [];
      await assert.rejects(buildLinuxDesktop({ ...f, execute: async (...args) => calls.push(args) }), /Refusing.*unowned.*bundle/);
      assert.deepEqual(calls, []);
      assert.equal(await readFile(sentinel, 'utf8'), 'other app must survive');
      for (const own of f.stale) assert.equal(await readFile(path.join(f.output, own), 'utf8'), 'stale');
    });
  }
});

test('ownership is checked again if another app writes bundles during the payload build', {
  skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async t => {
  const f = await fixture(t);
  const sentinel = path.join(f.output, 'bundle/another-app.deb');
  const calls = [];
  await assert.rejects(buildLinuxDesktop({ ...f, execute: async (command, args) => {
    calls.push([command, args]);
    await writeFile(sentinel, 'created while payload was building');
  } }), /Refusing.*unowned.*bundle/);
  assert.deepEqual(calls, [['npm', ['run', 'server:payload:linux']]]);
  assert.equal(await readFile(sentinel, 'utf8'), 'created while payload was building');
  for (const own of f.stale) assert.equal(await readFile(path.join(f.output, own), 'utf8'), 'stale');
});

test('own-product rebuilds retain default and Cargo-config output paths through restoration and staging', {
  skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async t => {
  for (const target of ['default', 'config']) {
    await t.test(target, async t => {
      const f = await fixture(t, target);
      const calls = [];
      await buildLinuxDesktop({ ...f, execute: async (command, args) => {
        calls.push([command, args]);
        if (args.includes('tauri')) for (const own of f.stale) await assert.rejects(readFile(path.join(f.output, own)), { code: 'ENOENT' });
      } });
      assert.equal(calls.length, 4);
      assert.equal(calls[1][1].includes('tauri'), true);
      assert.equal(path.basename(calls[2][1][0]), 'restore-linux-appimage.mjs');
      assert.equal(path.basename(calls[3][1][0]), 'stage-linux-desktop.mjs');
    });
  }
});
