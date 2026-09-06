import { spawn } from 'node:child_process';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { desktopPlatform, linuxDebDependencies } from '../../scripts/release/desktop-platforms.mjs';

const srcTauriDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const appCommands = new Set(['dev', 'build', 'bundle']);
const windowsTarget = 'x86_64-pc-windows-msvc';

function commandIndex(args) {
  return args.findIndex((argument) => !argument.startsWith('-'));
}

function isHelp(args) {
  const separator = args.indexOf('--');
  return args.slice(0, separator === -1 ? args.length : separator)
    .some((argument) => ['--help', '-h', '--version', '-V'].includes(argument));
}

function buildTarget(platform, arch) {
  if (platform === 'win32' && arch === 'x64') return windowsTarget;
  try {
    return desktopPlatform(platform, arch).target;
  } catch (error) {
    throw new Error(
      `Tauri desktop packaging requires Linux x64, macOS arm64, or native Windows x64 MSVC; received ${platform}-${arch}`,
      { cause: error },
    );
  }
}

export function prepareTauriArgs(args, {
  platform = process.platform,
  arch = process.arch,
  version,
  config,
} = {}) {
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
      throw new Error(`Tauri desktop packaging on ${platform}-${arch} only supports the ${target} target (require --target ${target})`);
    }
    if (!targets.length) tauriArgs.push('--target', target);
  }

  // Tauri automatically merges tauri.<platform>.conf.json. Overlay only the
  // version (and, for Linux, the host libc floor) so platform bundle settings
  // such as Windows NSIS or macOS DMG targets remain authoritative.
  tauriArgs.splice(index + 1, 0, '--config', config ?? JSON.stringify({ version }));
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

async function createOverlay(directory, platform, command, version, glibcVersion) {
  const overlay = { version };
  if (platform !== 'linux' || (command !== 'build' && command !== 'bundle')) return overlay;

  const linuxConfig = await readFile(join(directory, 'tauri.linux.conf.json'), 'utf8').then(JSON.parse);
  const dependencies = linuxConfig.bundle?.linux?.deb?.depends || [];
  const hostGlibc = glibcVersion ?? (process.platform === 'linux'
    ? process.report.getReport().header.glibcVersionRuntime
    : null);
  overlay.bundle = { linux: { deb: { depends: linuxDebDependencies(dependencies, hostGlibc) } } };
  return overlay;
}

function resolveCliPath() {
  try {
    return require.resolve('@tauri-apps/cli/tauri.js');
  } catch {
    return null;
  }
}

export async function runTauri(args, {
  directory = srcTauriDir,
  platform = process.platform,
  arch = process.arch,
  cliPath,
  env = process.env,
  glibcVersion,
} = {}) {
  const command = args[commandIndex(args)];
  const needsConfig = appCommands.has(command) && !isHelp(args);
  const version = needsConfig ? await desktopVersion(directory) : undefined;
  let overlayPath;

  try {
    let tauriArgs;
    if (needsConfig) {
      // Validate the native target before reading or writing platform overlays.
      prepareTauriArgs(args, { platform, arch, version });
      const overlay = await createOverlay(directory, platform, command, version, glibcVersion);
      overlayPath = join(directory, `.tauri-config-${process.pid}.json`);
      tauriArgs = prepareTauriArgs(args, {
        platform,
        arch,
        version,
        config: overlayPath,
      });
      if (platform === 'win32' && (command === 'build' || command === 'bundle')) {
        await checkWindowsPayload(directory);
      }
      await writeFile(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);
    } else {
      tauriArgs = prepareTauriArgs(args, {
        platform,
        arch,
        version,
      });
    }

    const childEnv = { ...env };
    // clap expects a boolean, but CI providers commonly export CI=1.
    if (childEnv.CI === '1') childEnv.CI = 'true';
    if (childEnv.CI === '0') childEnv.CI = 'false';

    const resolvedCliPath = cliPath ?? resolveCliPath();
    const commandPath = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
    const child = resolvedCliPath
      ? spawn(process.execPath, [resolvedCliPath, ...tauriArgs], {
        cwd: directory,
        stdio: 'inherit',
        env: childEnv,
        shell: false,
      })
      : spawn(commandPath, tauriArgs, {
        cwd: directory,
        stdio: 'inherit',
        env: childEnv,
        shell: false,
      });
    return await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode) => resolveExit(exitCode ?? 1));
    });
  } finally {
    if (overlayPath) await rm(overlayPath, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runTauri(process.argv.slice(2));
}
