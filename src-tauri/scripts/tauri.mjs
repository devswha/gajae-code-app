import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcTauriDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const appCommands = new Set(['dev', 'build', 'bundle']);

function commandIndex(args) {
  return args.findIndex((argument) => !argument.startsWith('-'));
}

function isHelp(args) {
  const separator = args.indexOf('--');
  return args.slice(0, separator === -1 ? args.length : separator)
    .some((argument) => ['--help', '-h', '--version', '-V'].includes(argument));
}

function buildTarget(platform, arch) {
  if (platform === 'darwin') return 'aarch64-apple-darwin';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  throw new Error(`Tauri desktop packaging requires macOS (arm64 target) or native Windows x64 MSVC; received ${platform}-${arch}`);
}

export function prepareTauriArgs(args, { platform = process.platform, arch = process.arch, version } = {}) {
  const index = commandIndex(args);
  const command = args[index];
  if (!appCommands.has(command) || isHelp(args)) return [...args];

  const separator = args.indexOf('--');
  const tauriArgs = args.slice(0, separator === -1 ? args.length : separator);
  const runnerArgs = separator === -1 ? [] : args.slice(separator);
  if (command === 'build' || command === 'bundle') {
    const target = buildTarget(platform, arch);
    const targets = [];
    for (let i = index + 1; i < tauriArgs.length; i += 1) {
      const argument = tauriArgs[i];
      if (argument === '--target' || argument === '-t') {
        targets.push(tauriArgs[++i]);
      } else if (argument.startsWith('--target=')) {
        targets.push(argument.slice('--target='.length));
      } else if (argument.startsWith('-t') && !argument.startsWith('--')) {
        targets.push(argument.slice(2).replace(/^=/, ''));
      }
    }
    if (targets.length > 1) throw new Error('Specify the Tauri target only once');
    if (targets.length && targets[0] !== target) {
      throw new Error(`Tauri desktop packaging on ${platform}-${arch} only supports the ${target} target`);
    }
    if (!targets.length) tauriArgs.push('--target', target);
  }

  // Tauri automatically merges tauri.windows.conf.json. Replaying the entire
  // base config here would overwrite its NSIS target and ICO with macOS values.
  tauriArgs.splice(index + 1, 0, '--config', JSON.stringify({ version }));
  return [...tauriArgs, ...runnerArgs];
}

async function desktopVersion(directory) {
  const [packageJson, cargoToml, config] = await Promise.all([
    readFile(join(dirname(directory), 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(directory, 'Cargo.toml'), 'utf8'),
    readFile(join(directory, 'tauri.conf.json'), 'utf8').then(JSON.parse),
  ]);
  if (typeof packageJson.desktopVersion !== 'string' || packageJson.desktopVersion.trim().length === 0) {
    throw new Error('package.json desktopVersion must be a non-empty string');
  }
  if ('version' in config) {
    throw new Error('src-tauri/tauri.conf.json must not declare version; it is overlaid from package.json desktopVersion');
  }
  const cargoPackage = cargoToml.split(/^\[package\][ \t]*\r?$/m)[1]?.split(/^\[/m)[0];
  const cargoVersion = cargoPackage?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (cargoVersion !== packageJson.desktopVersion) {
    throw new Error('src-tauri/Cargo.toml package.version must match package.json desktopVersion');
  }
  return packageJson.desktopVersion;
}

export async function checkWindowsPayload(directory) {
  const inputs = [
    'binaries/gajae-app-server-x86_64-pc-windows-msvc.exe',
    'resources/server-payload/dist-native/bun.exe',
    'resources/server-payload/dist-native/gajae-core.exe',
  ];
  const missing = [];
  for (const input of inputs) {
    const file = await stat(join(directory, input)).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!file?.isFile() || file.size === 0) missing.push(input);
  }
  if (missing.length) {
    throw new Error(`Missing Windows packaging inputs: ${missing.join(', ')}. Stage the Windows server payload and pinned Node sidecar before running Tauri.`);
  }
}

export async function runTauri(args, {
  directory = srcTauriDir,
  platform = process.platform,
  arch = process.arch,
  cliPath = require.resolve('@tauri-apps/cli/tauri.js'),
  env = process.env,
} = {}) {
  const command = args[commandIndex(args)];
  const needsConfig = appCommands.has(command) && !isHelp(args);
  const version = needsConfig ? await desktopVersion(directory) : undefined;
  const tauriArgs = prepareTauriArgs(args, { platform, arch, version });
  if (needsConfig && platform === 'win32' && (command === 'build' || command === 'bundle')) {
    await checkWindowsPayload(directory);
  }
  const childEnv = { ...env };
  // clap expects a boolean, but CI providers commonly export CI=1.
  if (childEnv.CI === '1') childEnv.CI = 'true';
  if (childEnv.CI === '0') childEnv.CI = 'false';
  const child = spawn(process.execPath, [cliPath, ...tauriArgs], {
    cwd: directory,
    stdio: 'inherit',
    env: childEnv,
    shell: false,
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => resolve(exitCode ?? 1));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runTauri(process.argv.slice(2));
}
