#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, chmod, copyFile, cp, readFile, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { packagedTargets } from './packaged-server-paths.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function restoreAppImageRuntime(appDir, { payloadDir, sidecarPath }) {
  const target = await packagedTargets(appDir, { linux: true });
  // linuxdeploy strips and rewrites RPATH on every ELF, including Bun and the
  // Gajae native addons whose original hashes are enforced at worker startup.
  // Restore the verified runtime after GTK deployment, before recompressing.
  await rm(target.cwd, { recursive: true });
  await cp(payloadDir, target.cwd, { recursive: true, dereference: false, verbatimSymlinks: true });
  await copyFile(sidecarPath, target.command);
  await chmod(target.command, 0o755);
  const manifest = JSON.parse(await readFile(path.join(target.cwd, 'server', 'gjc-runtime-manifest.json'), 'utf8'));
  const files = manifest.platforms?.['linux-x64']?.files;
  if (!files?.length) throw new Error('AppImage is missing the linux-x64 runtime manifest.');
  for (const entry of files) {
    const filename = path.join(target.cwd, 'node_modules', entry.package, entry.path);
    if (await sha256(filename) !== entry.sha256) throw new Error(`AppImage native hash mismatch: ${entry.package}/${entry.path}`);
  }
  for (const relative of ['dist-native/bun', 'dist-native/gajae-core']) {
    if (await sha256(path.join(target.cwd, relative)) !== await sha256(path.join(payloadDir, relative))) {
      throw new Error(`AppImage runtime copy mismatch: ${relative}`);
    }
  }
  return target;
}

async function appImagePlugin() {
  const roots = [
    process.env.TAURI_BUNDLER_TOOLS_CACHE_DIR,
    path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'tauri'),
  ].filter(Boolean);
  for (const root of roots) {
    const plugin = path.join(root, 'linuxdeploy-plugin-appimage.AppImage');
    try { await access(plugin); return plugin; } catch { /* Try the standard Tauri cache next. */ }
  }
  throw new Error('Tauri AppImage output plugin was not found; run the Tauri AppImage build first.');
}

export async function restoreLinuxAppImage(rootDir = repositoryRoot) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('AppImage restoration requires Linux x64.');
  const directory = path.join(rootDir, 'src-tauri', 'target', 'x86_64-unknown-linux-gnu', 'release', 'bundle', 'appimage');
  const entries = await readdir(directory, { withFileTypes: true });
  const appDirs = entries.filter(entry => entry.isDirectory() && entry.name.endsWith('.AppDir'));
  const images = entries.filter(entry => entry.isFile() && entry.name.endsWith('.AppImage'));
  if (appDirs.length !== 1 || images.length !== 1) throw new Error('Expected exactly one built AppDir and AppImage.');
  const appDir = path.join(directory, appDirs[0].name);
  const output = path.join(directory, images[0].name);
  const temporary = `${output}.restored-${process.pid}`;
  const plugin = await appImagePlugin();
  await restoreAppImageRuntime(appDir, {
    payloadDir: path.join(rootDir, 'src-tauri', 'resources', 'server-payload'),
    sidecarPath: path.join(rootDir, 'src-tauri', 'binaries', 'gajae-app-server-x86_64-unknown-linux-gnu'),
  });
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(plugin, ['--appimage-extract-and-run', '--appdir', appDir], {
        cwd: directory,
        env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', ARCH: 'x86_64', LDAI_OUTPUT: temporary },
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`AppImage recompression exited with code ${code}`)));
    });
    await chmod(temporary, 0o755);
    await rename(temporary, output);
    console.log(`Restored and verified the original Node/Bun/Gajae runtime in ${output}`);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await restoreLinuxAppImage();
