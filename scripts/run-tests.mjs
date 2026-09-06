import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:js|mjs|ts|tsx)$/;
// `.tsx` too: component tests that need a DOM run on Bun as well, under
// `*.dom.bun.test.tsx`.
const BUN_TEST_FILE_PATTERN = /\.bun\.(?:test|spec)\.tsx?$/;
// scripts/release contains source tests for the shipped packages. Only skip
// generated/dependency trees; top-level release artifacts are never test roots.
const SKIPPED_DIRECTORIES = new Set(['dist', 'dist-server', 'node_modules']);

const [nodeMajor, nodeMinor, nodePatch] = process.versions.node.split('.').map(Number);
const meetsMinimumNodeVersion =
  (nodeMajor === 22 && (nodeMinor > 22 || (nodeMinor === 22 && nodePatch >= 2))) ||
  (nodeMajor === 24 && (nodeMinor > 15 || (nodeMinor === 15 && nodePatch >= 0)));

if (!meetsMinimumNodeVersion) {
  console.error(
    `[test] Node 22.22.2+ (22.x) or 24.15.0+ (24.x) is required; current runtime is Node ${process.versions.node}.`,
  );
  process.exit(1);
}

async function collectTests(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files.sort();
}

function runTests(label, files, { tsconfig } = {}) {
  if (files.length === 0) {
    throw new Error(`[test] ${label}: no test files were discovered.`);
  }

  console.log(`\n[test] ${label}: ${files.length} files`);
  const args = tsconfig
    ? ['--import', 'tsx', '--test', ...files]
    : ['--test', ...files];
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: tsconfig ? { ...process.env, TSX_TSCONFIG_PATH: tsconfig } : process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const REQUIRED_BUN_VERSION = '1.4.0';

function resolveBunExecutable() {
  const bundled = path.join(process.cwd(), 'dist-native', process.platform === 'win32' ? 'bun.exe' : 'bun');
  const candidates = [bundled, 'bun'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return { path: candidate, version: probe.stdout.trim() };
  }
  return null;
}

function isolatedTestEnvironment() {
  const env = { ...process.env };
  // Test-created SDK sessions must not inherit the operator terminal identity.
  // Otherwise SessionManager publishes a temporary transcript as the active
  // tmux pane breadcrumb (for example terminal-sessions/tmux-%0).
  for (const name of ['TMUX', 'TMUX_PANE', 'KITTY_WINDOW_ID', 'TERM_SESSION_ID', 'WT_SESSION']) {
    delete env[name];
  }
  return env;
}

function runBunTests(label, files) {
  if (files.length === 0) return;
  const bun = resolveBunExecutable();
  if (!bun) {
    console.error(`[test] ${label}: Bun runtime is required (dist-native/bun or PATH); run scripts/fetch-bun.mjs.`);
    process.exit(1);
  }
  if (bun.version !== REQUIRED_BUN_VERSION) {
    console.error(`[test] ${label}: Bun ${REQUIRED_BUN_VERSION} is required; found ${bun.version || 'unknown'}.`);
    process.exit(1);
  }
  console.log(`\n[test] ${label}: ${files.length} files (bun ${bun.version})`);
  // Keep each contract file isolated so leaked globals, timers, or worker state
  // cannot make the aggregate Bun phase order-dependent.
  for (const file of files) {
    const result = spawnSync(bun.path, ['test', file], {
      cwd: process.cwd(),
      env: isolatedTestEnvironment(),
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

const [serverTestsAll, clientTests, scriptTests, desktopScriptTests] = await Promise.all([
  collectTests('server'),
  collectTests('src'),
  // Build and release tooling: plain Node, no tsconfig. This is where the
  // distribution-exclusion stubs are checked before any payload is built.
  collectTests('scripts'),
  collectTests('src-tauri/scripts'),
]);
const serverBunTests = serverTestsAll.filter((file) => BUN_TEST_FILE_PATTERN.test(file));
const serverTests = serverTestsAll.filter((file) => !BUN_TEST_FILE_PATTERN.test(file));
const clientBunTests = clientTests.filter((file) => BUN_TEST_FILE_PATTERN.test(file));
const clientNodeTests = clientTests.filter((file) => !BUN_TEST_FILE_PATTERN.test(file));

runTests('server', serverTests, { tsconfig: 'server/tsconfig.json' });
runBunTests('server-bun', serverBunTests);
runTests('client', clientNodeTests, { tsconfig: 'tsconfig.json' });
runBunTests('client-bun', clientBunTests);
runTests('scripts', [...scriptTests, ...desktopScriptTests]);
