import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

export type GjcCliShimOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  bunPath?: string;
  resolveRuntimeBin?: () => string | null;
  platform?: NodeJS.Platform;
};

function resolveRuntimeBin(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve('@gajae-code/coding-agent/package.json');
    const binPath = path.join(path.dirname(packagePath), 'bin', 'gjc.js');
    return existsSync(binPath) ? binPath : null;
  } catch {
    return null;
  }
}

function writeShimIfNeeded(shimPath: string, content: string): void {
  let existingContent: string | null = null;
  let existingMode: number | null = null;
  try {
    existingContent = readFileSync(shimPath, 'utf8');
    existingMode = statSync(shimPath).mode & 0o777;
  } catch {
    // A missing or unreadable shim is replaced below.
  }
  if (existingContent !== content) writeFileSync(shimPath, content, { mode: 0o755 });
  // writeFile's mode only applies to new files; replacing an existing shim
  // must also repair permissions left by an older installation.
  if (existingMode !== 0o755) chmodSync(shimPath, 0o755);
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function prependPath(env: NodeJS.ProcessEnv, shimDir: string, platform: NodeJS.Platform): void {
  const pathKey = platform === 'win32'
    ? Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
    : 'PATH';
  const entries = (env[pathKey] ?? '').split(path.delimiter).filter(Boolean);
  if (!entries.includes(shimDir)) env[pathKey] = [shimDir, ...entries].join(path.delimiter);
}

export function installGjcCliShim(options: GjcCliShimOptions = {}): { shimDir: string } | null {
  try {
    const env = options.env ?? process.env;
    const homeDir = options.homeDir ?? os.homedir();
    const bunPath = options.bunPath ?? process.execPath;
    const platform = options.platform ?? process.platform;
    const binPath = (options.resolveRuntimeBin ?? resolveRuntimeBin)();
    if (!binPath) return null;
    const shimDir = path.join(homeDir, '.gajae-app', 'gjc-cli-shim');
    mkdirSync(shimDir, { recursive: true });
    writeShimIfNeeded(path.join(shimDir, 'gjc'), `#!/bin/sh\nexec ${quoteShellArgument(bunPath)} ${quoteShellArgument(binPath)} "$@"\n`);
    if (platform === 'win32') {
      writeShimIfNeeded(path.join(shimDir, 'gjc.cmd'), `@echo off\r\n"${bunPath}" "${binPath}" %*\r\n`);
    }
    prependPath(env, shimDir, platform);
    return { shimDir };
  } catch {
    return null;
  }
}
