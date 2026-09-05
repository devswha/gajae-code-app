import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BUN_VERSION, fetchBun } from './fetch-bun.mjs';
import { downloadVerifiedArchive, extractWindowsZip } from './runtime-archive.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae bun 가재-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('Windows Bun is installed through an executable .exe staging path with the official pin', async t => {
  const root = await fixture(t);
  let archive;
  let temporaryBinary;
  const installed = await fetchBun({
    root, platformKey: 'win32-x64',
    download: async (url, target, digest) => {
      assert.equal(url, 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/bun-windows-x64.zip');
      assert.equal(digest, 'e6f093d39da486b20262ca8cdd5ed6a9e8bc9c2f275b78e6d3a0c5b28cc95901');
      archive = target;
      await fs.writeFile(target, 'downloaded');
    },
    extract: async (source, member, target, platform) => {
      assert.equal(source, archive);
      assert.equal(member, 'bun-windows-x64/bun.exe');
      assert.equal(platform, 'win32-x64');
      assert.match(target, /\.tmp\.exe$/);
      temporaryBinary = target;
      await fs.writeFile(target, 'verified Bun');
    },
    probe: async target => target === temporaryBinary ? BUN_VERSION : null,
  });
  assert.equal(installed, path.join(root, 'dist-native', 'bun.exe'));
  assert.equal(await fs.readFile(installed, 'utf8'), 'verified Bun');
  assert.deepEqual(await fs.readdir(path.dirname(installed)), ['bun.exe']);
  await assert.rejects(fs.access(path.dirname(archive)), { code: 'ENOENT' });
});

test('a wrong extracted version preserves the previous executable and cleans staging', async t => {
  const root = await fixture(t);
  const nativeDir = path.join(root, 'dist-native');
  await fs.mkdir(nativeDir);
  await fs.writeFile(path.join(nativeDir, 'bun.exe'), 'previous Bun');
  let archive;
  await assert.rejects(fetchBun({
    root, platformKey: 'win32-x64',
    download: async (_url, target) => { archive = target; await fs.writeFile(target, 'zip'); },
    extract: async (_archive, _member, target) => fs.writeFile(target, 'incorrect Bun'),
    probe: async () => '0.0.0',
  }), /did not report the requested version/);
  assert.equal(await fs.readFile(path.join(nativeDir, 'bun.exe'), 'utf8'), 'previous Bun');
  assert.deepEqual(await fs.readdir(nativeDir), ['bun.exe']);
  await assert.rejects(fs.access(path.dirname(archive)), { code: 'ENOENT' });
});

test('checksum failure prevents extraction and leaves the installed executable intact', async t => {
  const root = await fixture(t);
  const nativeDir = path.join(root, 'dist-native');
  await fs.mkdir(nativeDir);
  await fs.writeFile(path.join(nativeDir, 'bun.exe'), 'previous Bun');
  let extracted = false;
  await assert.rejects(fetchBun({
    root, platformKey: 'win32-x64', probe: async () => null,
    download: (url, target, digest) => downloadVerifiedArchive(url, target, digest, {
      fetchImpl: async () => new Response('tampered archive'),
    }),
    extract: async () => { extracted = true; },
  }), /SHA-256/);
  assert.equal(extracted, false);
  assert.deepEqual(await fs.readdir(nativeDir), ['bun.exe']);
  assert.equal(await fs.readFile(path.join(nativeDir, 'bun.exe'), 'utf8'), 'previous Bun');
});

test('an exact cached Bun avoids a download, and unsupported hosts fail before writes', async t => {
  const root = await fixture(t);
  const installed = await fetchBun({
    root, platformKey: 'win32-x64', probe: async () => BUN_VERSION,
    download: async () => assert.fail('cached Bun must not download'),
  });
  assert.equal(path.basename(installed), 'bun.exe');
  await assert.rejects(fetchBun({ root, platformKey: 'win32-arm64' }), /received win32-arm64/);
  assert.deepEqual(await fs.readdir(root), []);
});

test('runtime archive downloads verify content and remove failed or incomplete downloads', async t => {
  const root = await fixture(t);
  const archive = path.join(root, 'runtime.zip');
  const data = Buffer.from('a trusted runtime archive');
  const digest = createHash('sha256').update(data).digest('hex');
  await downloadVerifiedArchive('https://example.invalid/runtime.zip', archive, digest, { fetchImpl: async () => new Response(data) });
  assert.deepEqual(await fs.readFile(archive), data);
  await assert.rejects(downloadVerifiedArchive('https://example.invalid/runtime.zip', archive, digest, {
    fetchImpl: async () => new Response('not found', { status: 404 }),
  }), /HTTP 404/);
  await assert.rejects(fs.access(archive), { code: 'ENOENT' });
});

test('PowerShell ZIP extraction treats spaces, Unicode and metacharacters as literal data', async () => {
  const archive = String.raw`C:\Users\가재 name\archive [x] ' & $(noop).zip`;
  const destination = String.raw`C:\build output\압축 [y] ' & $(noop)`;
  let calls = 0;
  await extractWindowsZip(archive, destination, {
    env: { SYSTEMROOT: 'C:\\Windows', Path: 'C:\\tools' },
    execute: async (command, args, options) => {
      calls += 1;
      assert.equal(command, String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`);
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.equal(options.env.GAJAE_RUNTIME_ARCHIVE, archive);
      assert.equal(options.env.GAJAE_RUNTIME_EXTRACT, destination);
      assert.ok(args.includes('-NonInteractive'));
      assert.match(args.at(-1), /Expand-Archive -LiteralPath \$env:GAJAE_RUNTIME_ARCHIVE/);
      assert.ok(args.every(arg => !arg.includes(archive) && !arg.includes(destination)));
    },
  });
  assert.equal(calls, 1);
  await assert.rejects(extractWindowsZip(archive, destination, { execute: async () => { throw new Error('bad zip'); } }), /bad zip/);
});

test('Windows PowerShell extracts a real ZIP through paths containing spaces and Unicode', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t);
  const archive = path.join(root, "archive [가재] ' & $(noop).zip");
  const destination = path.join(root, "extracted [가재] ' & $(noop)");
  // A tiny deflated ZIP containing bun-windows-x64/bun.exe. The fixture is
  // deliberately not executable; this tests the actual OS extraction path.
  const zip = Buffer.from('UEsDBBQAAAAIAE6BJV2G5tSJFQAAABMAAAAXAAAAYnVuLXdpbmRvd3MteDY0L2J1bi5leGUrSS0uUXAqzVNIrUhNLi1JTMpJBQBQSwECFAMUAAAACABOgSVdhubUiRUAAAATAAAAFwAAAAAAAAAAAAAAgAEAAAAAYnVuLXdpbmRvd3MteDY0L2J1bi5leGVQSwUGAAAAAAEAAQBFAAAASgAAAAAA', 'base64');
  await fs.writeFile(archive, zip);
  await extractWindowsZip(archive, destination);
  assert.equal(await fs.readFile(path.join(destination, 'bun-windows-x64', 'bun.exe'), 'utf8'), 'test Bun executable');
});
