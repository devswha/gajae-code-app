import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { checkWindowsPayload, prepareTauriArgs, runTauri } from './tauri.mjs';

const execute = promisify(execFile);
const directory = dirname(dirname(fileURLToPath(import.meta.url)));
const windows = { platform: 'win32', arch: 'x64', version: '0.2.2' };
const mac = { ...windows, platform: 'darwin', arch: 'arm64' };
const windowsTarget = 'x86_64-pc-windows-msvc';
const macTarget = 'aarch64-apple-darwin';
const overlay = ['--config', '{"version":"0.2.2"}'];
const payloadInputs = [
  'binaries/gajae-app-server-x86_64-pc-windows-msvc.exe',
  'resources/server-payload/dist-native/bun.exe',
  'resources/server-payload/dist-native/gajae-core.exe',
];

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gajae tauri tests '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixtureDirectory = join(root, 'src-tauri');
  await mkdir(fixtureDirectory);
  await writeFile(join(root, 'package.json'), JSON.stringify({ desktopVersion: '0.2.2' }));
  await writeFile(join(fixtureDirectory, 'Cargo.toml'), '[package]\r\nname = "gajae-app"\r\nversion = "0.2.2"\r\n\r\n[dependencies]\r\n');
  await writeFile(join(fixtureDirectory, 'tauri.conf.json'), '{"bundle":{"targets":["dmg"]}}');
  const cliPath = join(root, 'fake tauri cli.mjs');
  const outputPath = join(root, 'result.json');
  await writeFile(cliPath, `
    import { writeFile } from 'node:fs/promises';
    await writeFile(process.env.TAURI_TEST_RESULT, JSON.stringify({
      executable: process.execPath, args: process.argv.slice(2), cwd: process.cwd(), ci: process.env.CI,
    }));
    process.exitCode = Number(process.env.TAURI_TEST_EXIT ?? 0);
  `);
  return {
    directory: fixtureDirectory, cliPath, outputPath, root,
    env: { ...process.env, TAURI_TEST_RESULT: outputPath, CI: '1' },
  };
}

async function stagePayload(fixtureDirectory) {
  for (const input of payloadInputs) {
    const destination = join(fixtureDirectory, input);
    await mkdir(dirname(destination), { recursive: true });
    // The wrapper checks presence; the root payload builder owns runtime hashes
    // and native smoke tests. These files are never executed.
    await writeFile(destination, 'staged runtime');
  }
}

test('native Windows builds and separate bundling select MSVC; macOS keeps arm64', () => {
  for (const command of ['build', 'bundle']) {
    assert.deepEqual(prepareTauriArgs([command], windows), [command, ...overlay, '--target', windowsTarget]);
    assert.deepEqual(prepareTauriArgs([command], mac), [command, ...overlay, '--target', macTarget]);
  }
  assert.deepEqual(prepareTauriArgs(['build', '--bundles', 'app'], mac), [
    'build', ...overlay, '--bundles', 'app', '--target', macTarget,
  ]);
});

test('all Tauri target flag forms are honored and incompatible targets rejected', () => {
  for (const options of [windows, mac]) {
    const target = options === windows ? windowsTarget : macTarget;
    for (const value of [target, 'x86_64-pc-windows-gnu', options === windows ? macTarget : windowsTarget]) {
      for (const flags of [['--target', value], [`--target=${value}`], ['-t', value], [`-t=${value}`], [`-t${value}`]]) {
        if (value === target) {
          assert.deepEqual(prepareTauriArgs(['build', ...flags], options), ['build', ...overlay, ...flags]);
        } else {
          assert.throws(() => prepareTauriArgs(['build', ...flags], options), /only supports/);
        }
      }
    }
  }
});

test('missing and repeated targets fail rather than silently selecting a sidecar', () => {
  for (const flags of [['--target'], ['-t'], ['--target='], ['-t='], ['--target', '--debug']]) {
    assert.throws(() => prepareTauriArgs(['build', ...flags], windows), /only supports/);
  }
  assert.throws(() => prepareTauriArgs(['build', '-t', windowsTarget, '--target', windowsTarget], windows), /only once/);
});

test('packaging rejects non-native Windows architectures and unsupported hosts', () => {
  for (const options of [
    { platform: 'win32', arch: 'arm64' },
    { platform: 'win32', arch: 'ia32' },
    { platform: 'linux', arch: 'x64' },
  ]) {
    assert.throws(() => prepareTauriArgs(['build'], { ...windows, ...options }), /requires macOS.*native Windows x64 MSVC/);
  }
});

test('version and default target stay before the Cargo argument separator', () => {
  const args = ['-v', 'build', '--config', 'C:\\build checkout\\custom.json', '--', '--locked'];
  const original = [...args];
  assert.deepEqual(prepareTauriArgs(args, windows), [
    '-v', 'build', ...overlay, '--config', 'C:\\build checkout\\custom.json', '--target', windowsTarget, '--', '--locked',
  ]);
  assert.deepEqual(args, original);
  assert.deepEqual(prepareTauriArgs(['build', '--', '--help'], windows), [
    'build', ...overlay, '--target', windowsTarget, '--', '--help',
  ]);
});

test('dev overlays the version without forcing a packaging target or a temporary config', () => {
  assert.deepEqual(prepareTauriArgs(['dev', '--no-watch'], windows), ['dev', ...overlay, '--no-watch']);
});

test('help, version, and unrelated commands are forwarded without build flags on any host', () => {
  for (const args of [[], ['--help'], ['--version'], ['info'], ['icon', '--help'], ['build', '--help'], ['bundle', '-h']]) {
    assert.deepEqual(prepareTauriArgs(args, { platform: 'linux', arch: 'x64' }), args);
  }
});

test('actual Node subprocess works with spaces, preserves arguments, propagates exit status, and normalizes CI', async (t) => {
  const f = await fixture(t);
  await stagePayload(f.directory);
  const env = { ...f.env, TAURI_TEST_EXIT: '17' };
  const args = ['build', '--config', join(f.root, 'custom config.json'), '--', '--locked'];
  assert.equal(await runTauri(args, { ...f, ...windows, env }), 17);
  const result = JSON.parse(await readFile(f.outputPath, 'utf8'));
  assert.equal(result.executable, process.execPath);
  assert.equal(result.cwd, f.directory);
  assert.deepEqual(result.args, prepareTauriArgs(args, windows));
  assert.equal(result.ci, 'true');
  assert.equal(env.CI, '1');
  assert.equal((await readdir(f.directory)).some((file) => file.startsWith('.tauri-config-')), false);
});

test('macOS invokes the same Node CLI and keeps macOS bundle overrides', async (t) => {
  const f = await fixture(t);
  const args = ['build', '--bundles', 'app'];
  assert.equal(await runTauri(args, { ...f, ...mac, env: { ...f.env, CI: '0' } }), 0);
  const result = JSON.parse(await readFile(f.outputPath, 'utf8'));
  assert.deepEqual(result.args, prepareTauriArgs(args, mac));
  assert.equal(result.ci, 'false');
});

test('Windows packaging fails before starting Tauri when sidecar or payload executables are absent', async (t) => {
  const f = await fixture(t);
  await assert.rejects(runTauri(['build'], { ...f, ...windows }), (error) => {
    for (const input of payloadInputs) assert.ok(error.message.includes(input));
    return true;
  });
  await assert.rejects(readFile(f.outputPath), { code: 'ENOENT' });
  await stagePayload(f.directory);
  await checkWindowsPayload(f.directory);
  await writeFile(join(f.directory, payloadInputs[1]), '');
  await assert.rejects(checkWindowsPayload(f.directory), /bun\.exe/);
  await rm(join(f.directory, payloadInputs[2]));
  await mkdir(join(f.directory, payloadInputs[2]));
  await assert.rejects(checkWindowsPayload(f.directory), /gajae-core\.exe/);
});

test('version drift fails before starting Tauri', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'Cargo.toml'), '[package]\nname = "test"\nversion = "9.9.9"\n');
  await assert.rejects(runTauri(['dev'], f), /package.version must match/);
  await writeFile(join(f.directory, 'Cargo.toml'), '[package]\nversion = "0.2.2"\n');
  await writeFile(join(f.directory, 'tauri.conf.json'), '{"version":"0.2.2"}');
  await assert.rejects(runTauri(['dev'], f), /must not declare version/);
  await writeFile(join(f.root, 'package.json'), '{"desktopVersion":""}');
  await assert.rejects(runTauri(['dev'], f), /desktopVersion must be a non-empty string/);
  await assert.rejects(readFile(f.outputPath), { code: 'ENOENT' });
});

test('a dependency version cannot masquerade as the Cargo package version', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'Cargo.toml'), '[package]\nname = "test"\n[dependencies.example]\nversion = "0.2.2"\n');
  await assert.rejects(runTauri(['dev'], f), /package.version must match/);
});

test('spawn errors reject rather than reporting a successful build', async (t) => {
  const f = await fixture(t);
  await assert.rejects(runTauri(['--help'], { ...f, directory: join(f.root, 'missing') }), { code: 'ENOENT' });
});

test('Windows overlay selects NSIS and ICO while preserving sidecar, payload layout, and macOS config', async () => {
  const base = JSON.parse(await readFile(join(directory, 'tauri.conf.json'), 'utf8'));
  const platformConfig = JSON.parse(await readFile(join(directory, 'tauri.windows.conf.json'), 'utf8'));
  const merged = { ...base, ...platformConfig, bundle: { ...base.bundle, ...platformConfig.bundle } };
  assert.deepEqual(base.bundle.targets, ['dmg']);
  assert.ok(base.bundle.icon.every((icon) => icon.endsWith('.png')));
  assert.equal(base.bundle.macOS.minimumSystemVersion, '11.0');
  assert.deepEqual(merged.bundle.targets, ['nsis']);
  assert.deepEqual(merged.bundle.icon, ['icons/icon.ico']);
  assert.deepEqual(merged.bundle.externalBin, ['binaries/gajae-app-server']);
  assert.deepEqual(merged.bundle.resources, ['resources/server-payload/']);
  assert.equal(merged.bundle.windows.nsis.installMode, 'currentUser');
  assert.equal(merged.bundle.windows.nsis.installerIcon, merged.bundle.windows.nsis.uninstallerIcon);
  assert.deepEqual(merged.bundle.windows.webviewInstallMode, { type: 'downloadBootstrapper', silent: true });
  assert.equal('version' in platformConfig, false);
  const configArgument = prepareTauriArgs(['build'], windows)[2];
  assert.deepEqual({ ...merged, ...JSON.parse(configArgument) }.bundle.targets, ['nsis']);
});

test('the installed Tauri CLI version and build help work through the wrapper without PATH shims', async () => {
  const script = join(directory, 'scripts', 'tauri.mjs');
  const version = await execute(process.execPath, [script, '--version']);
  assert.match(version.stdout, /tauri(?:-cli)? \d+\.\d+/);
  const help = await execute(process.execPath, [script, 'build', '--help']);
  assert.match(help.stdout, /--target/);
});
