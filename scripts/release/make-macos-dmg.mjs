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

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

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
const appPath = arg('--app', join(releaseDir, 'macos/Gajae App.app'));
const outDir = arg('--out', join(releaseDir, 'dmg'));

if (!existsSync(appPath)) {
  throw new Error(`App bundle not found: ${appPath}. Run \`npm run tauri -- build\` first.`);
}

const infoPlist = join(appPath, 'Contents/Info.plist');
const version = run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', infoPlist]).trim();
const identifier = run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', infoPlist]).trim();

// Verify the app is ad-hoc-valid before packaging (fail-closed).
run('codesign', ['--verify', '--strict', appPath]);

mkdirSync(outDir, { recursive: true });
const dmgPath = join(outDir, `Gajae-App_${version}_aarch64.dmg`);

const stage = mkdtempSync(join(tmpdir(), 'gajae-dmg-'));
try {
  run('cp', ['-R', appPath, stage]);
  run('ln', ['-s', '/Applications', join(stage, 'Applications')]);
  rmSync(dmgPath, { force: true });
  run('hdiutil', ['create', '-volname', 'Gajae App', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmgPath]);
  run('hdiutil', ['verify', dmgPath]);
} finally {
  rmSync(stage, { recursive: true, force: true });
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
  sha256,
  shaFile,
  version,
  identifier,
  signature: adhoc ? 'adhoc' : 'signed',
  note: 'Plain hdiutil DMG (no Finder cosmetics). Notarization + cosmetic layout require Apple credentials + a GUI session.',
}, null, 2));
void signatureInfo;
