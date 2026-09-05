import assert from 'node:assert/strict';
import { test } from 'node:test';

import { desktopBuildArgs, desktopPlatform } from './desktop-platforms.mjs';

test('native build selects the host target and preserves bundle options and runner arguments', () => {
  const args = ['build', '--bundles', 'deb,appimage', '--', '--locked'];
  assert.deepEqual(desktopBuildArgs(args, 'linux', 'x64'), [
    'build', '--bundles', 'deb,appimage', '--target', 'x86_64-unknown-linux-gnu', '--', '--locked',
  ]);
  assert.deepEqual(args, ['build', '--bundles', 'deb,appimage', '--', '--locked']);
  assert.deepEqual(desktopBuildArgs(['build'], 'darwin', 'arm64'), ['build', '--target', 'aarch64-apple-darwin']);
  assert.deepEqual(desktopBuildArgs(['dev', '--port', '5173'], 'linux', 'x64'), ['dev', '--port', '5173']);
});

test('explicit target forms cannot combine a foreign shell with native payload binaries', () => {
  for (const args of [
    ['--target', 'x86_64-unknown-linux-gnu'], ['--target=x86_64-unknown-linux-gnu'],
    ['-t', 'x86_64-unknown-linux-gnu'], ['-tx86_64-unknown-linux-gnu'],
  ]) assert.deepEqual(desktopBuildArgs(['build', ...args], 'linux', 'x64'), ['build', ...args]);
  for (const args of [
    ['--target', 'aarch64-apple-darwin'], ['--target=aarch64-apple-darwin'], ['-t', 'aarch64-apple-darwin'],
    ['--target'], ['--target', '--bundles', 'deb'],
    ['--target', 'x86_64-unknown-linux-gnu', '--target', 'aarch64-apple-darwin'],
  ]) assert.throws(() => desktopBuildArgs(['build', ...args], 'linux', 'x64'), /target/);
  assert.throws(() => desktopBuildArgs(['build', '--target', 'x86_64-unknown-linux-gnu'], 'darwin', 'arm64'), /target/);
});

test('unsupported desktop architectures fail before preparing platform artifacts', () => {
  for (const [platform, arch] of [['linux', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) {
    assert.throws(() => desktopPlatform(platform, arch), /Desktop builds support/);
    assert.throws(() => desktopBuildArgs(['build'], platform, arch), /Desktop builds support/);
  }
});
