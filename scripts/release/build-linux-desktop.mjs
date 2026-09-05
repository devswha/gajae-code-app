#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { desktopPlatform } from './desktop-platforms.mjs';

const desktop = desktopPlatform();
if (desktop.key !== 'linux-x64') throw new Error('Build Linux desktop packages on a Linux x64 host.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = { ...process.env, APPIMAGE_EXTRACT_AND_RUN: process.env.APPIMAGE_EXTRACT_AND_RUN || '1' };
delete env.CI;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`)));
  });
}

await run('npm', ['run', 'server:payload:linux']);
const releaseDir = path.join(root, 'src-tauri', 'target', desktop.target, 'release');
// Tauri reuses AppDir contents. Removed payload dependencies would otherwise
// remain in the next package, and old foreign ELF files can break linuxdeploy.
// Its build script also copies resources into the Cargo output directory.
await rm(path.join(releaseDir, 'resources', 'server-payload'), { recursive: true, force: true });
// appimage_deb is another intermediate tree reused by the AppImage bundler.
await rm(path.join(releaseDir, 'bundle'), { recursive: true, force: true });
await run('npm', ['run', 'tauri', '--', 'build', '--bundles', 'deb,appimage', '--', '--locked']);
await run(process.execPath, [path.join(root, 'scripts', 'release', 'restore-linux-appimage.mjs')]);
await run(process.execPath, [path.join(root, 'scripts', 'release', 'stage-linux-desktop.mjs')]);
