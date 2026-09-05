import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { stageLinuxDesktop } from './stage-linux-desktop.mjs';

async function fixture(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae-stage-linux-test-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ version: '2.0.0-beta.8', desktopVersion: '0.2.2' }));
  const bundle = path.join(rootDir, 'src-tauri/target/x86_64-unknown-linux-gnu/release/bundle');
  const deb = path.join(bundle, 'deb', 'Gajae Code App_0.2.2_amd64.deb');
  const appimage = path.join(bundle, 'appimage', 'Gajae Code App_0.2.2_amd64.AppImage');
  for (const file of [deb, appimage]) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `fixture: ${path.basename(file)}\n`);
  }
  await fs.chmod(deb, 0o640);
  await fs.chmod(appimage, 0o751);
  return { rootDir, bundle, deb, appimage, output: path.join(rootDir, 'release', 'desktop') };
}

test('stages both formats using package.version, correct checksums and original executable modes', async t => {
  const f = await fixture(t);
  // Tauri also leaves unpacked package directories in bundle/deb.
  await fs.mkdir(path.join(f.bundle, 'deb', 'unpacked.deb'));
  await fs.writeFile(`${f.appimage}.sha256`, 'not an AppImage');
  const result = await stageLinuxDesktop(f);
  assert.equal(result.ok, true);
  assert.equal(result.version, '2.0.0-beta.8');
  assert.equal(result.artifacts.length, 2);
  for (const [index, extension] of ['.deb', '.AppImage'].entries()) {
    const name = `gajae-app-desktop-2.0.0-beta.8-linux-x64${extension}`;
    const destination = path.join(f.output, name);
    const source = index === 0 ? f.deb : f.appimage;
    const bytes = await fs.readFile(source);
    assert.deepEqual(await fs.readFile(destination), bytes);
    assert.equal((await fs.stat(destination)).mode & 0o777, index === 0 ? 0o640 : 0o751);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(await fs.readFile(`${destination}.sha256`, 'utf8'), `${hash}  ${name}\n`);
    assert.deepEqual(result.artifacts[index], { source, artifact: destination, sha256: hash, shaFile: `${destination}.sha256` });
  }
  assert.equal((await fs.readdir(f.output)).length, 4);
  await fs.writeFile(f.deb, 'replacement package');
  await stageLinuxDesktop(f);
  assert.equal(await fs.readFile(result.artifacts[0].artifact, 'utf8'), 'replacement package');
});

test('missing formats, ambiguous artifacts and invalid input fail before replacing a staged release', async t => {
  const cases = [
    ['missing deb directory', async f => fs.rm(path.dirname(f.deb), { recursive: true }), /Missing \.deb artifact directory/],
    ['missing AppImage', async f => fs.rm(f.appimage), /exactly one \.AppImage.*found 0/],
    ['ambiguous deb', async f => fs.writeFile(path.join(path.dirname(f.deb), 'old.deb'), 'stale'), /exactly one \.deb.*found 2.*old\.deb/],
    ['ambiguous AppImage', async f => fs.writeFile(path.join(path.dirname(f.appimage), 'old.AppImage'), 'stale'), /exactly one \.AppImage.*found 2/],
    ['symlink artifact', async f => { await fs.rm(f.appimage); await fs.symlink(f.deb, f.appimage); }, /must be a regular file/],
    ['non-executable AppImage', async f => fs.chmod(f.appimage, 0o644), /AppImage is not executable/],
    ['empty deb', async f => fs.writeFile(f.deb, ''), /Artifact is empty/],
    ['unsafe version', async f => fs.writeFile(path.join(f.rootDir, 'package.json'), JSON.stringify({ version: '../elsewhere' })), /Invalid release artifact version/],
  ];
  for (const [name, mutate, expected] of cases) {
    await t.test(name, async t => {
      const f = await fixture(t);
      const initial = await stageLinuxDesktop(f);
      const snapshots = await Promise.all(initial.artifacts.flatMap(({ artifact, shaFile }) => [artifact, shaFile]).map(file => fs.readFile(file)));
      await mutate(f);
      await assert.rejects(stageLinuxDesktop(f), expected);
      const after = await Promise.all(initial.artifacts.flatMap(({ artifact, shaFile }) => [artifact, shaFile]).map(file => fs.readFile(file)));
      assert.deepEqual(after, snapshots);
      assert.equal((await fs.readdir(f.output)).length, 4);
    });
  }
});

test('the no-argument CLI locates the checkout from its own path, independently of cwd', async t => {
  const f = await fixture(t);
  const script = path.join(f.rootDir, 'scripts', 'release', 'stage-linux-desktop.mjs');
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.copyFile(new URL('./stage-linux-desktop.mjs', import.meta.url), script);
  const result = spawnSync(process.execPath, [script], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).artifacts.length, 2);
  const rejected = spawnSync(process.execPath, [script, '--unknown'], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Usage: node scripts\/release\/stage-linux-desktop.mjs/);
});
