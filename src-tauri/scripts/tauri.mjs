import { readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
const tauriArgs = process.argv.slice(2);
if (tauriArgs[0] === 'build') {
  const targetIndex = tauriArgs.findIndex((argument) => argument === '--target' || argument.startsWith('--target='));
  const configuredTarget = targetIndex === -1
    ? undefined
    : tauriArgs[targetIndex].startsWith('--target=')
      ? tauriArgs[targetIndex].slice('--target='.length)
      : tauriArgs[targetIndex + 1];

  if (configuredTarget !== undefined && configuredTarget !== 'aarch64-apple-darwin') {
    throw new Error('Tauri desktop builds only support the aarch64-apple-darwin target');
  }
  if (configuredTarget === undefined) {
    tauriArgs.push('--target', 'aarch64-apple-darwin');
  }
}

const overlayPath = join(srcTauriDir, `.tauri-config-${process.pid}.json`);
await writeFile(overlayPath, `${JSON.stringify({ ...config, version: packageJson.desktopVersion }, null, 2)}\n`);

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
