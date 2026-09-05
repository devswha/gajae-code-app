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
  const windows = platform === 'win32';
  const keys = windows ? Object.keys(env).filter((key) => key.toLowerCase() === 'path').sort() : ['PATH'];
  const pathKey = keys[0] ?? 'PATH';
  const delimiter = windows ? ';' : ':';
  const comparable = (entry: string) => windows ? entry.replaceAll('\\', '/').toLowerCase() : entry;
  const seen = new Set([comparable(shimDir)]);
  const entries = keys.flatMap((key) => (env[key] ?? '').split(delimiter)).filter((entry) => {
    if (!entry || seen.has(comparable(entry))) return false;
    seen.add(comparable(entry));
    return true;
  });
  // Node selects the first PATH spelling on Windows. Keep one key and put the
  // bundled CLI ahead of any previously installed global gjc shim.
  for (const key of keys.slice(1)) delete env[key];
  env[pathKey] = [shimDir, ...entries].join(delimiter);
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
    const shellPath = (value: string) => platform === 'win32' ? value.replaceAll('\\', '/') : value;
    writeShimIfNeeded(path.join(shimDir, 'gjc'), `#!/bin/sh\nexec ${quoteShellArgument(shellPath(bunPath))} ${quoteShellArgument(shellPath(binPath))} "$@"\n`);
    if (platform === 'win32') {
      // Batch files expand %variables% even inside quotes; !variables! expand
      // when the caller enabled delayed expansion. Neither is path syntax.
      if (/["\r\n\0]/u.test(bunPath + binPath)) return null;
      const batchPath = (value: string) => value.replaceAll('%', '%%');
      writeShimIfNeeded(path.join(shimDir, 'gjc.cmd'), `@echo off\r\nsetlocal DisableDelayedExpansion\r\n"${batchPath(bunPath)}" "${batchPath(binPath)}" %*\r\n`);
    }
    prependPath(env, shimDir, platform);
    return { shimDir };
  } catch {
    return null;
  }
}
