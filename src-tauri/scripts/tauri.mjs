import { readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { desktopBuildArgs, linuxDebDependencies } from '../../scripts/release/desktop-platforms.mjs';

const srcTauriDir = dirname(dirname(fileURLToPath(import.meta.url)));
const rootDir = dirname(srcTauriDir);
const [packageJson, cargoToml, config] = await Promise.all([
  readFile(join(rootDir, 'package.json'), 'utf8').then(JSON.parse),
  readFile(join(srcTauriDir, 'Cargo.toml'), 'utf8'),
  readFile(join(srcTauriDir, 'tauri.conf.json'), 'utf8').then(JSON.parse),
]);

if (typeof packageJson.desktopVersion !== 'string' || packageJson.desktopVersion.length === 0) {
  throw new Error('package.json desktopVersion must be a non-empty string');
}
if ('version' in config) {
  throw new Error('src-tauri/tauri.conf.json must not declare version; it is overlaid from package.json desktopVersion');
}

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
if (cargoVersion !== packageJson.desktopVersion) {
  throw new Error('src-tauri/Cargo.toml package.version must match package.json desktopVersion');
}
const tauriArgs = desktopBuildArgs(process.argv.slice(2));

const overlayPath = join(srcTauriDir, `.tauri-config-${process.pid}.json`);
// Tauri merges tauri.<platform>.conf.json itself. Do not overlay base macOS
// bundle targets onto Linux. Only Linux builds need the host libc floor.
const overlay = { version: packageJson.desktopVersion };
if (process.platform === 'linux' && tauriArgs[0] === 'build') {
  const linuxConfig = JSON.parse(await readFile(join(srcTauriDir, 'tauri.linux.conf.json'), 'utf8'));
  overlay.bundle = { linux: { deb: { depends: linuxDebDependencies(linuxConfig.bundle?.linux?.deb?.depends || []) } } };
}
await writeFile(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);

try {
  const command = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
  const subcommand = tauriArgs.length > 0 ? [tauriArgs[0]] : [];
  const rest = tauriArgs.slice(subcommand.length);
  const child = spawn(command, [...subcommand, '--config', overlayPath, ...rest], {
    cwd: srcTauriDir,
    stdio: 'inherit',
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  process.exitCode = code;
} finally {
  await rm(overlayPath, { force: true });
}
