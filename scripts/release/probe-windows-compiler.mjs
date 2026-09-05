// A fast native check that needs only Node, before installing npm dependencies.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { encodeWindowsPowerShellCommand, windowsCodeDomCompileScript } from '../../server/gjc-windows-job.ts';

import { assertWindowsHost, windowsSmokeEnvironment } from './windows-payload.mjs';

assertWindowsHost();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae compiler probe 가재 '));
try {
  const env = windowsSmokeEnvironment(path.dirname(process.execPath), path.join(root, 'profile 사용자'));
  for (const directory of new Set([
    env.HOME, env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME,
    env.XDG_CACHE_HOME, env.TEMP, env.WORKSPACES_ROOT, env.GJC_WORKER_AGENT_DIR,
  ])) await fs.mkdir(directory, { recursive: true });
  const source = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    windowsCodeDomCompileScript('public static class GajaeCompilerProbe { public static int Value() { return 42; } }', true),
    "if ([GajaeCompilerProbe]::Value() -ne 42) { throw 'Compiled probe returned an invalid result.' }",
    "[Console]::Out.WriteLine('Compiler probe passed.')",
  ].join('\n');
  let failed = false;
  for (const [label, environment] of [['baseline', process.env], ['isolated Unicode', env]]) {
    console.log(`Windows compiler probe: ${label}`);
    const result = spawnSync(path.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeWindowsPowerShellCommand(source),
    ], { cwd: root, env: environment, windowsHide: true, stdio: 'inherit', timeout: 60_000 });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) failed = true;
  }
  if (failed) process.exitCode = 1;
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
