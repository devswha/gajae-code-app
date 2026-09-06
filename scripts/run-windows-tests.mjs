import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { BUN_VERSION, versionOf } from './fetch-bun.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = process.argv.slice(2);
if (options.length > 1 || options.some(option => !['--server-only', '--scripts-only'].includes(option))) {
  throw new Error('Usage: node scripts/run-windows-tests.mjs [--server-only|--scripts-only]');
}
// The full existing suite remains in the Linux verify gate. This additional
// lane exercises the native Windows worker, PTY, path and packaging contracts.
const serverTests = [
  'server/gjc-windows-job.test.ts',
  'server/gjc-worker-client.test.ts',
  'server/gjc-core-host.test.ts',
  'server/gjc-engine-manifest.test.ts',
  'server/gjc-cli-shim.test.ts',
  'server/gjc-worker-protocol.test.ts',
  'server/gjc-worker-protocol-spec.test.ts',
  'server/routes/system.test.js',
  'server/modules/websocket/services/shell-command.test.ts',
  'server/modules/websocket/services/shell-websocket.service.test.ts',
  'server/utils/runtime-paths.test.js',
];
const scriptTests = ['scripts/lib/npm-cli.test.mjs'];
for (const directory of ['scripts', 'scripts/lib', 'scripts/release', 'src-tauri/scripts']) {
  for (const name of readdirSync(path.join(root, directory))) {
    if (/(?:windows|bun|tauri|runtime-archive).*\.test\.mjs$/.test(name)) {
      scriptTests.push(`${directory}/${name}`);
    }
  }
}

const groups = [
  ...(!options.includes('--scripts-only') ? [[serverTests, 'server/tsconfig.json']] : []),
  ...(!options.includes('--server-only') ? [[scriptTests, null]] : []),
];
const stateDirectory = mkdtempSync(path.join(os.tmpdir(), 'gajae-windows-tests-'));
const env = { ...process.env, DATABASE_PATH: path.join(stateDirectory, 'auth.db') };
// SDK fixtures must not overwrite the operator's active terminal breadcrumb.
for (const name of ['TMUX', 'TMUX_PANE', 'KITTY_WINDOW_ID', 'TERM_SESSION_ID', 'WT_SESSION']) {
  delete env[name];
}
let exitCode = 0;
try {
  for (const [files, tsconfig] of groups) {
    const result = spawnSync(process.execPath, [
      ...(tsconfig ? ['--import', 'tsx'] : []),
      '--test', '--test-concurrency=1', ...files,
    ], {
      cwd: root,
      env: tsconfig ? { ...env, TSX_TSCONFIG_PATH: tsconfig } : env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      exitCode = result.status ?? 1;
      break;
    }
  }
  if (exitCode === 0 && !options.includes('--scripts-only')) {
    const bun = path.join(root, 'dist-native', process.platform === 'win32' ? 'bun.exe' : 'bun');
    if (await versionOf(bun) !== BUN_VERSION) {
      throw new Error(`Bun ${BUN_VERSION} is required; run node scripts/fetch-bun.mjs.`);
    }
    // Workflow evidence runs Bun in child shells too. Use the same pinned
    // runtime there without changing the operator's process environment.
    const bunEnv = { ...env };
    const pathKey = Object.keys(bunEnv).find(key => key.toLowerCase() === 'path');
    const previousPath = pathKey ? bunEnv[pathKey] : '';
    for (const key of Object.keys(bunEnv)) {
      if (key.toLowerCase() === 'path') delete bunEnv[key];
    }
    bunEnv.PATH = [path.dirname(bun), previousPath].filter(Boolean).join(path.delimiter);
    for (const args of [
      ['scripts/probe-windows-sdk-locks.mjs'],
      ['test', 'server/gjc-sdk-contract.bun.test.ts', 'server/gjc-delegation-executor.bun.test.ts'],
    ]) {
      const result = spawnSync(bun, args, {
        cwd: root,
        env: bunEnv,
        stdio: ['ignore', 'inherit', 'inherit'],
        ...(args[0] === 'test' ? {} : { timeout: 30_000 }),
      });
      if (result.error) throw result.error;
      // Keep the full suites enabled even when the isolated native probe fails.
      if (result.status !== 0) exitCode = result.status ?? 1;
    }
  }
} finally {
  rmSync(stateDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exitCode = exitCode;
