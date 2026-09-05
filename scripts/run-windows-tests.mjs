import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The full existing suite remains in the Linux verify gate. This additional
// lane exercises the native Windows worker, PTY, path and packaging contracts.
const serverTests = [
  'server/gjc-windows-job.test.ts',
  'server/gjc-worker-client.test.ts',
  'server/gjc-core-host.test.ts',
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

for (const [files, tsconfig] of [[serverTests, 'server/tsconfig.json'], [scriptTests, null]]) {
  const result = spawnSync(process.execPath, [
    ...(tsconfig ? ['--import', 'tsx'] : []),
    '--test', '--test-concurrency=1', ...files,
  ], {
    cwd: root,
    env: tsconfig ? { ...process.env, TSX_TSCONFIG_PATH: tsconfig } : process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
