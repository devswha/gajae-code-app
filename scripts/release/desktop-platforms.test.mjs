import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import Handlebars from 'handlebars';

import { desktopBuildArgs, desktopPlatform, desktopTargetDirectory, linuxDebDependencies } from './desktop-platforms.mjs';

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

test('Cargo output resolution honors target-dir config and absolute/relative environment overrides', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-cargo-output-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tauri = path.join(root, 'src-tauri');
  await mkdir(path.join(tauri, 'src'), { recursive: true });
  await mkdir(path.join(tauri, '.cargo'));
  await writeFile(path.join(tauri, 'src/main.rs'), 'fn main() {}');
  await writeFile(path.join(tauri, 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n');
  const env = { ...process.env, CARGO_HOME: path.join(root, 'cargo-home') };
  delete env.CARGO_TARGET_DIR;
  delete env.CARGO_BUILD_TARGET_DIR;
  assert.equal(await desktopTargetDirectory(root, env), path.join(tauri, 'target'));
  await writeFile(path.join(tauri, '.cargo/config.toml'), '[build]\ntarget-dir = "configured target"\ntarget = "aarch64-apple-darwin"\n');
  assert.equal(await desktopTargetDirectory(root, env), path.join(tauri, 'configured target'));
  assert.equal(await desktopTargetDirectory(root, { ...env, CARGO_TARGET_DIR: '../relative target' }), path.join(root, 'relative target'));
  assert.equal(await desktopTargetDirectory(root, { ...env, CARGO_TARGET_DIR: path.join(root, 'absolute target') }), path.join(root, 'absolute target'));
  // A Cargo default target cannot override the explicit native Tauri target.
  assert.deepEqual(desktopBuildArgs(['build'], 'linux', 'x64'), ['build', '--target', 'x86_64-unknown-linux-gnu']);
});

test('Debian dependencies declare the build-host glibc floor and preserve existing requirements', () => {
  const dependencies = ['git', 'ca-certificates', 'libc6 (>= 2.35)'];
  assert.deepEqual(linuxDebDependencies(dependencies, '2.35'), dependencies);
  assert.deepEqual(linuxDebDependencies(dependencies, '2.39'), [...dependencies, 'libc6 (>= 2.39)']);
  for (const version of [null, '', 'musl', '2.39\nDepends: other']) {
    assert.throws(() => linuxDebDependencies(dependencies, version), /requires a glibc host/);
  }
});

test('Tauri wrapper adds the Linux libc floor, preserves Mac overlays and removes temporary config on failures', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-tauri-wrapper-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tauri = path.join(root, 'src-tauri');
  await mkdir(path.join(tauri, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'scripts/release'), { recursive: true });
  await mkdir(path.join(root, 'bin'));
  for (const relative of ['src-tauri/scripts/tauri.mjs', 'src-tauri/tauri.conf.json', 'src-tauri/tauri.linux.conf.json', 'scripts/release/desktop-platforms.mjs']) {
    await copyFile(new URL(`../../${relative}`, import.meta.url), path.join(root, relative));
  }
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ desktopVersion: '0.2.2' }));
  await writeFile(path.join(tauri, 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.2.2"\n');
  const preload = path.join(root, 'platform.cjs');
  await writeFile(preload, `
    Object.defineProperty(process, 'platform', { value: process.env.TEST_PLATFORM });
    Object.defineProperty(process, 'arch', { value: process.env.TEST_ARCH });
    process.report.getReport = () => ({ header: { glibcVersionRuntime: process.env.TEST_GLIBC } });
  `);
  const log = path.join(root, 'invocation.json');
  await writeFile(path.join(root, 'bin/tauri'), `#!${process.execPath}\n
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    const overlay = JSON.parse(fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
    fs.writeFileSync(process.env.TEST_LOG, JSON.stringify({ args, overlay }));
    process.exit(Number(process.env.TEST_EXIT || 0));
  `, { mode: 0o755 });
  const env = { ...process.env, PATH: path.join(root, 'bin'), TEST_LOG: log, TEST_PLATFORM: 'linux', TEST_ARCH: 'x64', TEST_GLIBC: '2.39' };
  const invoke = (args, overrides = {}) => spawnSync(process.execPath, ['--require', preload, path.join(tauri, 'scripts/tauri.mjs'), ...args], {
    env: { ...env, ...overrides }, encoding: 'utf8', cwd: os.tmpdir(),
  });
  const linux = invoke(['build', '--bundles', 'deb', '--', '--locked']);
  assert.equal(linux.status, 0, linux.stderr);
  const built = JSON.parse(await readFile(log, 'utf8'));
  assert.deepEqual(built.overlay, { version: '0.2.2', bundle: { linux: { deb: {
    depends: ['git', 'ca-certificates', 'desktop-file-utils', 'libnss3', 'libc6 (>= 2.35)', 'libc6 (>= 2.39)'],
  } } } });
  assert.deepEqual(built.args.slice(-4), ['--target', 'x86_64-unknown-linux-gnu', '--', '--locked']);
  const mac = invoke(['build', '--bundles', 'dmg'], { TEST_PLATFORM: 'darwin', TEST_ARCH: 'arm64' });
  assert.equal(mac.status, 0, mac.stderr);
  const macBuilt = JSON.parse(await readFile(log, 'utf8'));
  assert.deepEqual(macBuilt.overlay, { version: '0.2.2' });
  assert.deepEqual(macBuilt.args.slice(-2), ['--target', 'aarch64-apple-darwin']);
  const dev = invoke(['dev']);
  assert.equal(dev.status, 0, dev.stderr);
  assert.deepEqual(JSON.parse(await readFile(log, 'utf8')).overlay, { version: '0.2.2' });
  const musl = invoke(['build'], { TEST_GLIBC: '' });
  assert.notEqual(musl.status, 0);
  assert.match(musl.stderr, /requires a glibc host/);
  const foreign = invoke(['build', '--target=aarch64-apple-darwin']);
  assert.notEqual(foreign.status, 0);
  assert.match(foreign.stderr, /require --target/);
  assert.equal(invoke(['build'], { TEST_EXIT: '7' }).status, 7);
  const missing = invoke(['build'], { PATH: path.join(root, 'missing') });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /ENOENT/);
  assert.equal((await readdir(tauri)).some(name => name.startsWith('.tauri-config-')), false);
});

async function desktopEntry() {
  const [config, linux, packageJson] = await Promise.all([
    readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../src-tauri/tauri.linux.conf.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../package.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  assert.ok(linux.bundle.linux.deb.depends.includes('desktop-file-utils'), 'Debian installation must populate the desktop MIME cache');
  assert.equal(typeof linux.bundle.linux.deb.desktopTemplate, 'string');
  const template = await readFile(new URL(`../../src-tauri/${linux.bundle.linux.deb.desktopTemplate}`, import.meta.url), 'utf8');
  // Tauri's freedesktop generator renders Handlebars with no escaping and
  // supplies mime_type from configured file associations and deep-link schemes.
  const render = Handlebars.compile(template, { noEscape: true });
  const context = {
    name: config.productName, exec: `${packageJson.name}-desktop`, icon: `${packageJson.name}-desktop`,
    categories: 'Development;', comment: 'Gajae Code App desktop shell',
    mime_type: config.plugins['deep-link'].desktop.schemes.map(scheme => `x-scheme-handler/${scheme}`).join(';'),
  };
  return { context, render, rendered: render(context) };
}

test('Linux desktop metadata forwards URIs and renders the configured MIME registration once', async () => {
  const { context, render, rendered } = await desktopEntry();
  assert.equal(rendered.split('\n').find(line => line.startsWith('Exec=')), `Exec=${context.exec} %U`);
  assert.deepEqual(rendered.split('\n').filter(line => line.startsWith('MimeType=')), [`MimeType=${context.mime_type}`]);
  assert.equal(rendered.includes('{{'), false);
  const withoutScheme = render({ ...context, mime_type: undefined });
  assert.equal(withoutScheme.split('\n').some(line => line.startsWith('MimeType=')), false);
});

test('Linux desktop MIME cache discovers the entry and gio forwards the URI to its executable', {
  skip: process.platform !== 'linux',
}, async t => {
  for (const command of ['desktop-file-validate', 'update-desktop-database', 'gio']) {
    const result = spawnSync(command, ['--help'], { encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') { t.skip(`${command} is not installed`); return; }
    assert.ifError(result.error);
  }
  const { context, rendered } = await desktopEntry();
  const root = await mkdtemp(path.join(os.tmpdir(), 'gajae-desktop-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const applications = path.join(root, 'data/applications');
  for (const directory of [applications, path.join(root, 'config'), path.join(root, 'empty'), path.join(root, 'bin')]) await mkdir(directory, { recursive: true });
  const file = path.join(applications, `${context.name}.desktop`);
  await writeFile(file, rendered);
  const argv = path.join(root, 'argv.json');
  await writeFile(path.join(root, 'bin', context.exec), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(argv)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  // All discovery and execution use a disposable data root and a stub command;
  // this must not activate the installed desktop app or use the user's session.
  const env = {
    PATH: `${path.join(root, 'bin')}:/usr/bin:/bin`, HOME: root, LANG: 'C',
    XDG_DATA_HOME: path.join(root, 'data'), XDG_DATA_DIRS: path.join(root, 'empty'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CONFIG_DIRS: path.join(root, 'empty'),
  };
  for (const [command, args] of [['desktop-file-validate', [file]], ['update-desktop-database', [applications]]]) {
    const result = spawnSync(command, args, { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const cache = await readFile(path.join(applications, 'mimeinfo.cache'), 'utf8');
  assert.ok(cache.includes(`${context.mime_type}=${context.name}.desktop;`), cache);
  const discovery = spawnSync('gio', ['mime', context.mime_type], { env, encoding: 'utf8' });
  assert.equal(discovery.status, 0, discovery.stderr);
  assert.ok(discovery.stdout.includes(`${context.name}.desktop`), discovery.stdout);
  const scheme = context.mime_type.slice('x-scheme-handler/'.length);
  const uri = `${scheme}://open?path=%2Ftmp%2Fproject&session=session-123`;
  const launch = spawnSync('gio', ['open', uri], { env, encoding: 'utf8' });
  assert.equal(launch.status, 0, launch.stderr);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assert.deepEqual(JSON.parse(await readFile(argv, 'utf8')), [uri]);
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('gio did not forward the URI to the fixture executable');
});
