#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, openSync, closeSync, readSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
/**
 * Ad-hoc is the default so unsigned local builds keep working. Notarization
 * requires a Developer ID identity and a secure timestamp on every Mach-O in
 * the bundle, which ad-hoc signatures cannot carry.
 */
const identity = process.env.APPLE_SIGNING_IDENTITY?.trim() || '-';
const adhoc = identity === '-';
const timestamp = adhoc ? '--timestamp=none' : '--timestamp';

function run(command, args, { combined = false } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return combined ? `${result.stdout || ''}${result.stderr || ''}` : result.stdout;
}

const MACH_O_MAGIC = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);
/**
 * Bun loads the GJC native addon into its own process, so under the hardened
 * runtime it needs the same library-validation exception the sidecar carries -
 * otherwise dyld rejects the addon for having a different team than the
 * process that maps it.
 */
const NATIVE_HOSTS = new Set(['bun']);

function isMachO(filePath) {
  const handle = openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    return readSync(handle, header, 0, 4, 0) === 4 && MACH_O_MAGIC.has(header.readUInt32BE(0));
  } finally {
    closeSync(handle);
  }
}

/**
 * Notarization rejects a bundle if any Mach-O inside it is unsigned or signed
 * by someone else, so the closure is found by file format rather than by a list
 * of names a new vendored binary would silently fall outside of.
 */
function executableClosure(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...executableClosure(filePath));
    } else if (entry.isFile() && !entry.isSymbolicLink() && isMachO(filePath)) {
      files.push(filePath);
    }
  }
  return files;
}

function signArguments(filePath) {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const hardened = ['--force', '--sign', identity, timestamp, '--options', 'runtime'];
  return NATIVE_HOSTS.has(name) ? [...hardened, '--entitlements', entitlements] : hardened;
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * The bundled worker refuses to start unless every native the runtime manifest
 * pins still hashes to its recorded value, and signing a native rewrites it.
 * The manifest is therefore checked against the bytes that were installed
 * (their provenance) and restamped with the bytes that ship (what the worker
 * will load), before the outer signature seals the bundle.
 */
function runtimeManifests(payloadDir) {
  return ['server', 'dist-server/server']
    .map((location) => join(payloadDir, location, 'gjc-runtime-manifest.json'))
    .filter((manifestPath) => existsSync(manifestPath));
}

function manifestClosure(manifestPath, payloadDir) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const files = manifest.platforms?.['darwin-arm64']?.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`Runtime manifest is missing the darwin-arm64 closure: ${manifestPath}`);
  }
  return {
    manifest,
    files: files.map((file) => ({ ...file, filePath: join(payloadDir, 'node_modules', file.package, file.path) })),
  };
}

function assertManifestProvenance(payloadDir) {
  const manifestPaths = runtimeManifests(payloadDir);
  if (manifestPaths.length === 0) throw new Error(`No runtime manifest found under ${payloadDir}`);
  for (const manifestPath of manifestPaths) {
    for (const file of manifestClosure(manifestPath, payloadDir).files) {
      if (!existsSync(file.filePath)) {
        throw new Error(`Runtime manifest native is missing from the bundle: ${file.package}/${file.path}`);
      }
      if (sha256(file.filePath) !== file.sha256) {
        throw new Error(`Runtime manifest native does not match its installed bytes: ${file.package}/${file.path}`);
      }
    }
  }
  return manifestPaths;
}

function restampRuntimeManifests(payloadDir, manifestPaths) {
  const restamped = [];
  for (const manifestPath of manifestPaths) {
    const { manifest, files } = manifestClosure(manifestPath, payloadDir);
    for (const file of files) {
      const digest = sha256(file.filePath);
      if (digest === file.sha256) continue;
      const entry = manifest.platforms['darwin-arm64'].files
        .find((candidate) => candidate.package === file.package && candidate.path === file.path);
      entry.sha256 = digest;
      restamped.push(`${file.package}/${file.path}`);
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    for (const file of manifestClosure(manifestPath, payloadDir).files) {
      if (sha256(file.filePath) !== file.sha256) {
        throw new Error(`Runtime manifest restamp did not settle: ${file.package}/${file.path}`);
      }
    }
  }
  return [...new Set(restamped)].sort();
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(`macOS app finalization requires darwin-arm64; received ${process.platform}-${process.arch}.`);
}
if (!existsSync(appPath)) throw new Error(`App bundle not found: ${appPath}`);
if (!existsSync(entitlements)) throw new Error(`Entitlements file not found: ${entitlements}`);
if (!adhoc && !run('security', ['find-identity', '-v', '-p', 'codesigning']).includes(identity)) {
  throw new Error(`Signing identity is not available in the keychain: ${identity}`);
}

const resources = join(appPath, 'Contents', 'Resources');
const payloadDir = join(resources, 'resources', 'server-payload');
const sidecar = join(appPath, 'Contents', 'MacOS', 'gajae-app-server');
const desktop = join(appPath, 'Contents', 'MacOS', 'gajae-app-desktop');
const nestedExecutables = executableClosure(resources).sort();
const manifestPaths = assertManifestProvenance(payloadDir);

for (const executable of nestedExecutables) {
  run('codesign', [...signArguments(executable), executable]);
}

const restamped = restampRuntimeManifests(payloadDir, manifestPaths);

run('codesign', [
  '--force', '--sign', identity, timestamp, '--options', 'runtime',
  '--entitlements', entitlements, sidecar,
]);
run('codesign', [
  '--force', '--sign', identity, timestamp, '--options', 'runtime',
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
  restampedNatives: restamped,
  signature: adhoc ? 'adhoc' : identity,
}, null, 2));
