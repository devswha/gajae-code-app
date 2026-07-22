#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const defaultApp = join(
  rootDir,
  'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Gajae Code App.app',
);
const appIndex = process.argv.indexOf('--app');
const appPath = appIndex >= 0 && process.argv[appIndex + 1] ? process.argv[appIndex + 1] : defaultApp;
const entitlements = join(rootDir, 'src-tauri/entitlements.plist');

function run(command, args, { combined = false } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return combined ? `${result.stdout || ''}${result.stderr || ''}` : result.stdout;
}

function executableClosure(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...executableClosure(filePath));
    } else if (
      entry.isFile()
      && (entry.name.endsWith('.node') || ['bun', 'gajae-core', 'spawn-helper'].includes(entry.name))
    ) {
      files.push(filePath);
    }
  }
  return files;
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(`macOS app finalization requires darwin-arm64; received ${process.platform}-${process.arch}.`);
}
if (!existsSync(appPath)) throw new Error(`App bundle not found: ${appPath}`);
if (!existsSync(entitlements)) throw new Error(`Entitlements file not found: ${entitlements}`);

const resources = join(appPath, 'Contents', 'Resources');
const sidecar = join(appPath, 'Contents', 'MacOS', 'gajae-app-server');
const desktop = join(appPath, 'Contents', 'MacOS', 'gajae-app-desktop');
const nestedExecutables = executableClosure(resources).sort();

for (const executable of nestedExecutables) {
  // Gajae native binaries are release-hashed by gjc-runtime-manifest.json and
  // arrive signed. Re-signing them would invalidate that runtime integrity
  // contract, so verify their existing signature and only sign local closure.
  if (executable.includes('/node_modules/@gajae-code/')) {
    run('codesign', ['--verify', '--strict', executable]);
  } else {
    run('codesign', ['--force', '--sign', '-', '--timestamp=none', executable]);
  }
}

run('codesign', [
  '--force', '--sign', '-', '--timestamp=none', '--options', 'runtime',
  '--entitlements', entitlements, sidecar,
]);
run('codesign', [
  '--force', '--sign', '-', '--timestamp=none', '--options', 'runtime',
  '--entitlements', entitlements, appPath,
]);

for (const executable of nestedExecutables) run('codesign', ['--verify', '--strict', executable]);
run('codesign', ['--verify', '--strict', sidecar]);
run('codesign', ['--verify', '--strict', desktop]);
run('codesign', ['--verify', '--deep', '--strict', appPath]);
run('lipo', [desktop, '-verify_arch', 'arm64']);
run('lipo', [sidecar, '-verify_arch', 'arm64']);

const sidecarEntitlements = run('codesign', ['-d', '--entitlements', ':-', sidecar], { combined: true });
for (const entitlement of [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
]) {
  if (!sidecarEntitlements.includes(`<key>${entitlement}</key>`)) {
    throw new Error(`Sidecar is missing required entitlement: ${entitlement}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  app: appPath,
  nestedExecutables: nestedExecutables.map(filePath => relative(appPath, filePath)),
  signature: 'adhoc',
}, null, 2));
