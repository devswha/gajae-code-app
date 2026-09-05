import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function environmentValue(env: NodeJS.ProcessEnv, requested: string): string | undefined {
  const key = Object.keys(env).find((entry) => entry.toLowerCase() === requested.toLowerCase());
  return key ? env[key] : undefined;
}

function directoryExists(directory: string): boolean {
  try { return fs.statSync(directory).isDirectory(); } catch { return false; }
}

function fileExists(file: string): boolean {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

const unquotePath = (entry: string): string => entry.startsWith('"') && entry.endsWith('"') ? entry.slice(1, -1) : entry;

export function buildShellEnvironment(env: NodeJS.ProcessEnv, {
  platform = os.platform(), home = os.homedir(), execPath = process.execPath, isDirectory = directoryExists,
} = {}): NodeJS.ProcessEnv {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const result: NodeJS.ProcessEnv = { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '3' };
  const pathKeys = windows ? Object.keys(env).filter((key) => key.toLowerCase() === 'path') : ['PATH'];
  const entries = pathKeys.flatMap((key) => (env[key] ?? '').split(paths.delimiter)).filter(Boolean);
  const keyFor = (entry: string): string => windows ? paths.normalize(unquotePath(entry)).replace(/[\\/]+$/, '').toLowerCase() : entry;
  const existing = new Set(entries.map(keyFor));
  const prefix = windows ? environmentValue(env, 'npm_config_prefix') : env.npm_config_prefix;
  const appData = windows ? environmentValue(env, 'APPDATA') : undefined;
  const candidates = windows ? [
    prefix,
    appData ? paths.join(appData, 'npm') : paths.join(home, 'AppData', 'Roaming', 'npm'),
    paths.join(home, '.npm-global', 'bin'),
    paths.dirname(execPath),
    paths.join(environmentValue(env, 'SystemRoot') || 'C:\\Windows', 'System32'),
  ] : [prefix ? paths.join(prefix, 'bin') : undefined, paths.join(home, '.npm-global', 'bin')];
  const promoted = candidates.filter((candidate): candidate is string => Boolean(candidate && paths.isAbsolute(candidate)
    && (existing.has(keyFor(candidate)) || (windows && isDirectory(candidate)))));
  if (!windows && !promoted.length) return result;
  const seen = new Set<string>();
  const ordered = [...promoted, ...entries].filter((entry) => {
    const key = keyFor(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Windows environment keys are case-insensitive. Leaving both Path and PATH
  // lets the subprocess launcher silently choose the unmodified value.
  for (const key of pathKeys) delete result[key];
  if (ordered.length || pathKeys.some((key) => env[key] !== undefined)) result.PATH = ordered.join(paths.delimiter);
  return result;
}

export function buildGjcShellCommand(resumeId: string, env: NodeJS.ProcessEnv, {
  platform = os.platform(), isFile = fileExists,
} = {}): string {
  if (resumeId && !/^[a-zA-Z0-9_.\-:]+$/.test(resumeId)) throw new Error('Invalid provider session ID');
  if (platform !== 'win32') return resumeId ? `gjc --resume "${resumeId}" || gjc` : 'gjc';

  // npm installs both .ps1 and .cmd shims. Prefer an executable or cmd shim so
  // the default Windows PowerShell execution policy cannot block the provider.
  const directories = (environmentValue(env, 'PATH') ?? '').split(';').map(unquotePath).filter((entry) => path.win32.isAbsolute(entry));
  const executable = directories.flatMap((directory) => ['gjc.exe', 'gjc.cmd', 'gjc.bat'].map((name) => path.win32.join(directory, name))).find(isFile) ?? 'gjc';
  const encoded = Buffer.from(executable, 'utf8').toString('base64');
  const invoke = `& ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))`;
  return resumeId ? `${invoke} --resume '${resumeId}'; if (-not $?) { ${invoke} }` : invoke;
}

export function buildShellLaunch(command: string, env: NodeJS.ProcessEnv, platform = os.platform()): { executable: string; args: string[] } {
  if (platform !== 'win32') return { executable: 'bash', args: command.trim() ? ['-c', command] : ['-i'] };
  const root = environmentValue(env, 'SystemRoot') || 'C:\\Windows';
  return {
    executable: path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    // No command means a live prompt. EncodedCommand preserves quotes across
    // node-pty's Windows argv serialization without disabling interactivity.
    args: ['-NoLogo', '-NoProfile', ...(command.trim() ? ['-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')] : [])],
  };
}
