import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const capture = promisify(execFile);

export const DESKTOP_NODE_VERSION = '22.22.2';

const platforms = {
  'darwin-arm64': {
    label: 'macOS arm64',
    target: 'aarch64-apple-darwin',
    nodePlatform: 'darwin-arm64',
    nodeSha256: 'db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000',
  },
  'linux-x64': {
    label: 'Linux x64',
    target: 'x86_64-unknown-linux-gnu',
    nodePlatform: 'linux-x64',
    nodeSha256: '978978a635eef872fa68beae09f0aad0bbbae6757e444da80b570964a97e62a3',
  },
};

export function desktopPlatform(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  const settings = platforms[key];
  if (!settings) throw new Error(`Desktop builds support darwin-arm64 and linux-x64; received ${key}.`);
  return { ...settings, key, nodeArchive: `node-v${DESKTOP_NODE_VERSION}-${settings.nodePlatform}.tar.gz` };
}

// Match Tauri's Cargo metadata lookup, including .cargo/config.toml and
// relative CARGO_TARGET_DIR values (resolved from src-tauri, not the caller).
export async function desktopTargetDirectory(rootDir, env = process.env) {
  const { stdout } = await capture('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], {
    cwd: path.join(rootDir, 'src-tauri'), env,
  });
  const { target_directory: targetDirectory } = JSON.parse(stdout);
  if (typeof targetDirectory !== 'string' || !path.isAbsolute(targetDirectory)) {
    throw new Error('Cargo metadata did not report an absolute target_directory.');
  }
  return path.resolve(targetDirectory);
}

export function linuxDebDependencies(dependencies, glibcVersion = process.report.getReport().header.glibcVersionRuntime) {
  if (typeof glibcVersion !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(glibcVersion)) {
    throw new Error('Linux desktop packaging requires a glibc host.');
  }
  // Locally compiled Rust/native addons may require the host's newer libc,
  // even though Tauri only automatically adds GTK/WebKit dependencies.
  return [...new Set([...dependencies, `libc6 (>= ${glibcVersion})`])];
}

// Native addons and the server payload must be built on the target OS/CPU.
export function desktopBuildArgs(args, platform = process.platform, arch = process.arch) {
  if (args[0] !== 'build') return [...args];
  const { target } = desktopPlatform(platform, arch);
  const separator = args.indexOf('--');
  const options = separator < 0 ? args : args.slice(0, separator);
  const targetOptions = options.flatMap((argument, index) => {
    if (argument === '--target' || argument === '-t') return [options[index + 1]];
    if (argument.startsWith('--target=')) return [argument.slice('--target='.length)];
    if (argument.startsWith('-t') && argument.length > 2) return [argument.slice(2).replace(/^=/, '')];
    return [];
  });
  if (targetOptions.length === 0) {
    return [...options, '--target', target, ...(separator < 0 ? [] : args.slice(separator))];
  }
  if (targetOptions.length > 1) throw new Error('Specify the desktop --target only once.');
  const [configured] = targetOptions;
  if (configured !== target) {
    throw new Error(`Desktop builds on ${platform}-${arch} require --target ${target}; build the payload on the same host.`);
  }
  return [...args];
}
