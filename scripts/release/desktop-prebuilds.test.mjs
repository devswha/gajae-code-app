import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { pruneForeignPrebuilds } from './desktop-prebuilds.mjs';

test('Linux payload omits foreign ELF prebuilds but keeps host binaries and package source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-prebuilds-'));
  try {
    for (const relative of [
      'bare-url/prebuilds/linux-x64/bare-url.bare', 'bare-url/prebuilds/android-x64/bare-url.bare',
      'bare-url/prebuilds/linux-arm64/bare-url.bare', 'bare-url/prebuilds/darwin-arm64/bare-url.bare',
      'bare-url/lib/linux-x64/index.js', 'nested/node_modules/bare-fs/prebuilds/win32-x64/bare-fs.bare',
      'bare-url/prebuilds/metadata/source.json',
    ]) {
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await writeFile(path.join(root, relative), relative);
    }
    await symlink('bare-url', path.join(root, 'alias'));
    assert.deepEqual(await pruneForeignPrebuilds(root, 'linux', 'x64'), [
      'bare-url/prebuilds/android-x64', 'bare-url/prebuilds/darwin-arm64',
      'bare-url/prebuilds/linux-arm64', 'nested/node_modules/bare-fs/prebuilds/win32-x64',
    ]);
    for (const relative of ['bare-url/prebuilds/linux-x64/bare-url.bare', 'bare-url/lib/linux-x64/index.js', 'bare-url/prebuilds/metadata/source.json']) {
      assert.equal(await readFile(path.join(root, relative), 'utf8'), relative);
    }
    assert.deepEqual(await pruneForeignPrebuilds(root, 'linux', 'x64'), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('glibc desktop payload removes musl-only optional packages at both npm package depths', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'gajae-libc-'));
  const root = path.join(temporary, 'node_modules');
  try {
    for (const [name, libc] of [
      ['css-gnu', ['glibc']], ['css-musl', ['musl']],
      ['@native/gnu', ['glibc']], ['@native/musl', ['musl']],
      ['portable', ['musl', 'glibc']],
    ]) {
      await mkdir(path.join(root, name), { recursive: true });
      await writeFile(path.join(root, name, 'package.json'), JSON.stringify({ name, libc }));
    }
    assert.deepEqual(await pruneForeignPrebuilds(root, 'linux', 'x64'), ['@native/musl', 'css-musl']);
    for (const name of ['css-gnu', '@native/gnu', 'portable']) {
      assert.equal(JSON.parse(await readFile(path.join(root, name, 'package.json'), 'utf8')).name, name);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
