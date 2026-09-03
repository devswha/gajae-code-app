#!/usr/bin/env node
// Builds a plain, installable macOS arm64 DMG from the Tauri-built .app bundle.
//
// Rationale: `tauri build` produces and ad-hoc-signs the .app, then tries to
// package a cosmetic DMG via bundle_dmg.sh, which drives Finder/AppleScript to
// lay out the window. That step requires a GUI WindowServer session and fails in
// a headless SSH build. This script produces a functional drag-to-Applications
// DMG with `hdiutil` (no Finder cosmetics), which is installable and verifiable
// headlessly. Cosmetic layout/notarization remain a GUI+credential concern.
//
// Usage: node scripts/release/make-macos-dmg.mjs [--app <path>] [--out <dir>]
//        [--artifact-version <release version>]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const MAX_DMG_BYTES = 250 * 1024 * 1024;
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim() || '-';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

if (process.platform !== 'darwin') {
  throw new Error('make-macos-dmg.mjs must run on macOS (needs hdiutil/PlistBuddy).');
}

const releaseDir = join(rootDir, 'src-tauri/target/aarch64-apple-darwin/release/bundle');
const appPath = arg('--app', join(releaseDir, 'macos/Gajae Code App.app'));
const outDir = arg('--out', join(releaseDir, 'dmg'));

if (!existsSync(appPath)) {
  throw new Error(`App bundle not found: ${appPath}. Run \`npm run tauri -- build\` first.`);
}

const infoPlist = join(appPath, 'Contents/Info.plist');
const appVersion = run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', infoPlist]).trim();
const releaseVersion = arg(
  '--artifact-version',
  JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).version,
);
if (typeof releaseVersion !== 'string'
    || !/^[0-9A-Za-z][0-9A-Za-z.-]*$/.test(releaseVersion)
    || releaseVersion.includes('..')) {
  throw new Error(`Invalid release artifact version: ${releaseVersion}`);
}
const identifier = run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', infoPlist]).trim();

// Finalize the nested signature from the inside out, then verify the complete
// app before packaging. This catches native-addon signatures that a shallow
// bundle verification would miss.
//
// A stapled bundle is left alone: re-signing is not byte-identical (every
// secure timestamp changes the nested signatures the resource seal hashes, so
// the bundle's cdhash moves) and the ticket already stapled at
// Contents/CodeResources would no longer match the app it ships with.
const stapledTicket = join(appPath, 'Contents/CodeResources');
const stapled = existsSync(stapledTicket);
if (stapled) {
  run('codesign', ['--verify', '--deep', '--strict', appPath]);
  run('xcrun', ['stapler', 'validate', appPath]);
} else {
  run(process.execPath, [join(rootDir, 'scripts/release/finalize-macos-app.mjs'), '--app', appPath]);
}

/**
 * What Finder does to the image is the test that matters: mount it, copy the
 * app out to a writable volume, verify the signature there. A signature that
 * only holds on the read-only mount is the one that says "damaged" after
 * install.
 */
function verifyCopiedFromImage(imagePath) {
  const mountPoint = mkdtempSync(join(tmpdir(), 'gajae-dmg-mount-'));
  const copyRoot = mkdtempSync(join(tmpdir(), 'gajae-dmg-copy-'));
  try {
    run('hdiutil', ['attach', imagePath, '-nobrowse', '-readonly', '-mountpoint', mountPoint]);
    try {
      const copied = join(copyRoot, basename(appPath));
      run('ditto', [join(mountPoint, basename(appPath)), copied]);
      run('codesign', ['--verify', '--deep', '--strict', copied]);
    } finally {
      run('hdiutil', ['detach', mountPoint]);
    }
  } finally {
    rmSync(copyRoot, { recursive: true, force: true });
    rmSync(mountPoint, { recursive: true, force: true });
  }
}

mkdirSync(outDir, { recursive: true });
const dmgPath = join(outDir, `gajae-app-desktop-${releaseVersion}-macos-arm64.dmg`);

const stage = mkdtempSync(join(tmpdir(), 'gajae-dmg-'));
try {
  run('cp', ['-R', appPath, stage]);
  run('ln', ['-s', '/Applications', join(stage, 'Applications')]);
  rmSync(dmgPath, { force: true });
  // APFS, not hdiutil's HFS+ default: HFS+ rewrites file names into NFD, so a
  // name outside ASCII comes back from the image with different bytes than the
  // code signature sealed, and the app that verified on the mount reports
  // "a sealed resource is missing or invalid" once copied to /Applications.
  // The payload builder refuses such names too; this keeps the image honest
  // for anything it did not see. APFS images mount on macOS 10.13+.
  run('hdiutil', ['create', '-fs', 'APFS', '-volname', 'Gajae Code App', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmgPath]);
  run('hdiutil', ['verify', dmgPath]);
  verifyCopiedFromImage(dmgPath);
  // Notarization is submitted for the disk image, and an unsigned image cannot
  // carry a stapled ticket. The identity matches the one the app was finalized
  // with, so the checksum below is always taken from the image that ships.
  run('codesign', [
    '--force', '--sign', signingIdentity,
    signingIdentity === '-' ? '--timestamp=none' : '--timestamp',
    dmgPath,
  ]);
  run('codesign', ['--verify', '--strict', dmgPath]);
} finally {
  rmSync(stage, { recursive: true, force: true });
}

const dmgBytes = statSync(dmgPath).size;
if (dmgBytes > MAX_DMG_BYTES) {
  throw new Error(`DMG size regression: ${dmgBytes} bytes exceeds ${MAX_DMG_BYTES} bytes.`);
}

const sha256 = createHash('sha256').update(readFileSync(dmgPath)).digest('hex');
const shaFile = `${dmgPath}.sha256`;
writeFileSync(shaFile, `${sha256}  ${basename(dmgPath)}\n`);

const signatureInfo = run('codesign', ['-dv', appPath]).trim();
const adhoc = /Signature=adhoc/.test(spawnSync('codesign', ['-dv', appPath], { encoding: 'utf8' }).stderr || '');

console.log(JSON.stringify({
  ok: true,
  app: appPath,
  dmg: dmgPath,
  dmgBytes,
  maxDmgBytes: MAX_DMG_BYTES,
  sha256,
  shaFile,
  appVersion,
  releaseVersion,
  identifier,
  signature: adhoc ? 'adhoc' : signingIdentity,
  appFinalized: stapled ? 'kept (stapled ticket present)' : 're-signed',
  note: 'Plain hdiutil DMG (no Finder cosmetics). Notarization + cosmetic layout require Apple credentials + a GUI session.',
}, null, 2));
void signatureInfo;
