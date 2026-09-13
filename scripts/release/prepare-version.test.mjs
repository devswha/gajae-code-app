import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  planVersionUpdate,
  readVersionState,
  writeVersionUpdate,
} from './prepare-version.mjs';

const SCRIPT = fileURLToPath(new URL('./prepare-version.mjs', import.meta.url));
const VERSION_FILES = [
  'package.json',
  'package-lock.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
];

async function fixture(t, {
  productVersion = '1.2.0-beta.1',
  desktopVersion = '0.2.4',
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src-tauri'), { recursive: true });

  const packageJson = {
    name: 'gajae-app',
    private: true,
    version: productVersion,
    desktopVersion,
    productName: 'Gajae Code App',
    build: { appId: 'app.gajae.desktop', protocols: [{ schemes: ['gajae-app'] }] },
    dependencies: { example: '^1.0.0' },
  };
  const packageLock = {
    name: 'gajae-app',
    version: productVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'gajae-app',
        version: productVersion,
        dependencies: { example: '^1.0.0' },
      },
      'node_modules/example': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz',
        integrity: 'sha512-example',
      },
    },
  };
  const cargoToml = `[package]\nname = "gajae-app-desktop"\nversion = "${desktopVersion}"\nedition = "2021"\n\n[dependencies]\nexample = "1"\n`;
  const cargoLock = `# generated fixture\nversion = 4\n\n[[package]]\nname = "example"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n\n[[package]]\nname = "gajae-app-desktop"\nversion = "${desktopVersion}"\ndependencies = [\n "example",\n]\n`;
  await Promise.all([
    writeFile(path.join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`),
    writeFile(path.join(root, 'package-lock.json'), `${JSON.stringify(packageLock, null, 2)}\n`),
    writeFile(path.join(root, 'src-tauri/Cargo.toml'), cargoToml),
    writeFile(path.join(root, 'src-tauri/Cargo.lock'), cargoLock),
  ]);
  return root;
}

async function snapshot(root) {
  return Promise.all(VERSION_FILES.map(async relative => [
    relative,
    await readFile(path.join(root, relative)),
  ]));
}

function assertSnapshotEqual(actual, expected) {
  assert.deepEqual(actual.map(([relative, bytes]) => [relative, bytes.toString('utf8')]),
    expected.map(([relative, bytes]) => [relative, bytes.toString('utf8')]));
}

test('the repository version sources are synchronized without changing the current release', async () => {
  const state = await readVersionState(fileURLToPath(new URL('../..', import.meta.url)));
  assert.deepEqual({ productVersion: state.productVersion, desktopVersion: state.desktopVersion }, {
    productVersion: '2.0.0-beta.15',
    desktopVersion: '0.2.9',
  });
});

test('candidate planning is read-only and the write updates every root field', async t => {
  const root = await fixture(t);
  const before = await snapshot(root);
  const candidate = { productVersion: '1.2.0-beta.2', desktopVersion: '0.2.5' };
  const plan = await planVersionUpdate(root, candidate);
  assert.deepEqual(plan.current, { productVersion: '1.2.0-beta.1', desktopVersion: '0.2.4' });
  assert.deepEqual(plan.candidate, candidate);
  assert.deepEqual(plan.files.map(file => file.relative), VERSION_FILES);
  assertSnapshotEqual(await snapshot(root), before);

  const result = await writeVersionUpdate(root, candidate);
  assert.deepEqual(result.current, plan.current);
  assert.deepEqual(result.candidate, candidate);
  const state = await readVersionState(root);
  assert.deepEqual({ productVersion: state.productVersion, desktopVersion: state.desktopVersion }, candidate);

  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.deepEqual(packageJson.build, { appId: 'app.gajae.desktop', protocols: [{ schemes: ['gajae-app'] }] });
  assert.deepEqual(packageJson.dependencies, { example: '^1.0.0' });
  assert.deepEqual(packageLock.packages[''].dependencies, { example: '^1.0.0' });
  assert.equal(packageLock.packages['node_modules/example'].integrity, 'sha512-example');
  assert.match(await readFile(path.join(root, 'src-tauri/Cargo.toml'), 'utf8'), /example = "1"/);
  assert.match(await readFile(path.join(root, 'src-tauri/Cargo.lock'), 'utf8'), / "example",/);
});

test('invalid, unsynchronized, and non-monotonic candidates fail before any file is written', async t => {
  const cases = [
    {
      candidate: { productVersion: 'v1.2.0-beta.2', desktopVersion: '0.2.5' },
      message: /strict SemVer/,
    },
    {
      candidate: { productVersion: '1.2.0-beta.1', desktopVersion: '0.2.5' },
      message: /must be greater than current/,
    },
    {
      candidate: { productVersion: '1.2.0-beta.2', desktopVersion: '0.2.4' },
      message: /must be greater than current/,
    },
  ];
  for (const { candidate, message } of cases) {
    const root = await fixture(t);
    const before = await snapshot(root);
    await assert.rejects(writeVersionUpdate(root, candidate), message);
    assertSnapshotEqual(await snapshot(root), before);
  }

  const root = await fixture(t);
  const lockPath = path.join(root, 'package-lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.packages[''].version = '1.2.0-beta.0';
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const before = await snapshot(root);
  await assert.rejects(writeVersionUpdate(root, {
    productVersion: '1.2.0-beta.2', desktopVersion: '0.2.5',
  }), /out of sync/);
  assertSnapshotEqual(await snapshot(root), before);
});

test('rollback refuses to overwrite a same-length concurrent edit', async t => {
  const root = await fixture(t);
  const candidate = { productVersion: '1.2.0-beta.2', desktopVersion: '0.2.5' };
  const plan = await planVersionUpdate(root, candidate);
  const packagePath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const external = Buffer.from(plan.files.find(file => file.relative === 'package.json').bytes);
  const marker = Buffer.from(candidate.productVersion);
  const offset = external.indexOf(marker);
  assert.notEqual(offset, -1);
  external.set(Buffer.from('1.2.0-beta.3'), offset);
  assert.equal(external.length, plan.files.find(file => file.relative === 'package.json').bytes.length);
  const lockBefore = await readFile(lockPath);
  let renameCount = 0;

  await assert.rejects(writeVersionUpdate(root, candidate, {
    beforeRename: async () => {
      renameCount += 1;
      if (renameCount === 2) {
        await writeFile(packagePath, external);
        throw new Error('injected rename failure');
      }
    },
  }), /rollback was incomplete/);
  assert.equal(renameCount, 2);
  assert.deepEqual(await readFile(packagePath), external);
  assert.deepEqual(await readFile(lockPath), lockBefore);
  assert.equal((await readdir(root)).some(name => name.includes('.gajae-version-')), false);
});

test('CLI defaults to a read-only check and requires explicit complete write inputs', async t => {
  const root = await fixture(t);
  const before = await snapshot(root);
  const check = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(JSON.parse(check.stdout).current, {
    productVersion: '1.2.0-beta.1', desktopVersion: '0.2.4',
  });
  assertSnapshotEqual(await snapshot(root), before);

  const missing = spawnSync(process.execPath, [SCRIPT, '--root', root, '--write', '--product-version', '1.2.0-beta.2'], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /both --product-version and --desktop-version/);
  assertSnapshotEqual(await snapshot(root), before);

  const dryRun = spawnSync(process.execPath, [
    SCRIPT, '--root', root, '--product-version', '1.2.0-beta.2', '--desktop-version', '0.2.5',
  ], { encoding: 'utf8' });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).mode, 'check');
  assertSnapshotEqual(await snapshot(root), before);
});
