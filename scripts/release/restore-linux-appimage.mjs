#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, chmod, copyFile, cp, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { packagedTargets } from './packaged-server-paths.mjs';
import { desktopTargetDirectory } from './desktop-platforms.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function restoreAppImageRuntime(appDir, { payloadDir, sidecarPath }) {
  const target = await packagedTargets(appDir, { linux: true });
  // Check the original inputs before replacing the deployed runtime tree.
  const manifest = JSON.parse(await readFile(path.join(payloadDir, 'server', 'gjc-runtime-manifest.json'), 'utf8'));
  const files = manifest.platforms?.['linux-x64']?.files;
  if (!Array.isArray(files) || !files.length) throw new Error('AppImage is missing the linux-x64 runtime manifest.');
  for (const entry of files) {
    const filename = path.join(payloadDir, 'node_modules', entry.package, entry.path);
    if (await sha256(filename) !== entry.sha256) throw new Error(`AppImage native hash mismatch: ${entry.package}/${entry.path}`);
  }
  for (const executable of [sidecarPath, ...['bun', 'gajae-core'].map(name => path.join(payloadDir, 'dist-native', name))]) {
    await access(executable, constants.X_OK);
  }
  // linuxdeploy strips and rewrites RPATH on every ELF, including Bun and the
  // Gajae native addons whose original hashes are enforced at worker startup.
  // Restore the verified runtime after GTK deployment, before recompressing.
  await rm(target.cwd, { recursive: true });
  await cp(payloadDir, target.cwd, { recursive: true, dereference: false, verbatimSymlinks: true });
  await copyFile(sidecarPath, target.command);
  await chmod(target.command, 0o755);
  for (const entry of files) {
    const filename = path.join(target.cwd, 'node_modules', entry.package, entry.path);
    if (await sha256(filename) !== entry.sha256) throw new Error(`AppImage native hash mismatch: ${entry.package}/${entry.path}`);
  }
  for (const relative of ['dist-native/bun', 'dist-native/gajae-core']) {
    if (await sha256(path.join(target.cwd, relative)) !== await sha256(path.join(payloadDir, relative))) {
      throw new Error(`AppImage runtime copy mismatch: ${relative}`);
    }
  }
  if (await sha256(target.command) !== await sha256(sidecarPath)) throw new Error('AppImage Node runtime copy mismatch.');
  return target;
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'ignore', 'inherit'] });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`AppImage tool exited with code ${code}`)));
  });
}

export async function appImagePlugin({ targetDir, env = process.env }) {
  const roots = [
    env.TAURI_BUNDLER_TOOLS_CACHE_DIR,
    path.join(targetDir, '.tauri'),
    path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'tauri'),
  ].filter(Boolean);
  for (const root of roots) {
    const plugin = path.join(root, 'linuxdeploy-plugin-appimage.AppImage');
    try {
      if (!(await stat(plugin)).isFile()) continue;
      await access(plugin, constants.X_OK);
      return { command: plugin, args: ['--appimage-extract-and-run'], cleanup: async () => {} };
    } catch (error) { if (!['ENOENT', 'EACCES'].includes(error.code)) throw error; }
  }
  // Tauri's separate plugin download is optional. Its linuxdeploy AppImage
  // carries a built-in output plugin, which needs extraction but no ELF deploy.
  for (const root of roots) {
    const linuxdeploy = path.join(root, 'linuxdeploy-x86_64.AppImage');
    try { await access(linuxdeploy, constants.X_OK); }
    catch (error) { if (['ENOENT', 'EACCES'].includes(error.code)) continue; throw error; }
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'gajae-appimage-tools-'));
    const cleanup = () => rm(temporary, { recursive: true, force: true });
    try {
      await run(linuxdeploy, ['--appimage-extract'], { cwd: temporary, env });
      const command = path.join(temporary, 'squashfs-root', 'usr', 'bin', 'linuxdeploy-plugin-appimage');
      await access(command, constants.X_OK);
      return { command, args: [], cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
  throw new Error('Tauri AppImage output plugin was not found; run the Tauri AppImage build first.');
}

export async function restoreLinuxAppImage(rootDir = repositoryRoot, { targetDir, env = process.env } = {}) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('AppImage restoration requires Linux x64.');
  targetDir ||= await desktopTargetDirectory(rootDir, env);
  const directory = path.join(targetDir, 'x86_64-unknown-linux-gnu', 'release', 'bundle', 'appimage');
  const entries = await readdir(directory, { withFileTypes: true });
  const appDirs = entries.filter(entry => entry.isDirectory() && entry.name.endsWith('.AppDir'));
  const images = entries.filter(entry => entry.isFile() && entry.name.endsWith('.AppImage'));
  if (appDirs.length !== 1 || images.length !== 1) throw new Error('Expected exactly one built AppDir and AppImage.');
  const { productName, desktopVersion } = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
  if (appDirs[0].name !== `${productName}.AppDir` || images[0].name !== `${productName}_${desktopVersion}_amd64.AppImage`) {
    throw new Error(`Unexpected AppImage artifact; expected ${productName}.AppDir and ${productName}_${desktopVersion}_amd64.AppImage.`);
  }
  const appDir = path.join(directory, appDirs[0].name);
  const output = path.join(directory, images[0].name);
  const temporary = `${output}.restored-${process.pid}`;
  const plugin = await appImagePlugin({ targetDir, env });
  try {
    await restoreAppImageRuntime(appDir, {
      payloadDir: path.join(rootDir, 'src-tauri', 'resources', 'server-payload'),
      sidecarPath: path.join(rootDir, 'src-tauri', 'binaries', 'gajae-app-server-x86_64-unknown-linux-gnu'),
    });
    await run(plugin.command, [...plugin.args, '--appdir', appDir], {
      cwd: directory,
      env: { ...env, APPIMAGE_EXTRACT_AND_RUN: '1', ARCH: 'x86_64', LDAI_OUTPUT: temporary },
    });
    const result = await stat(temporary);
    if (!result.isFile() || result.size === 0) throw new Error('AppImage recompression produced an empty or invalid artifact.');
    await chmod(temporary, 0o755);
    await rename(temporary, output);
    console.log(`Restored and verified the original Node/Bun/Gajae runtime in ${output}`);
  } finally {
    await rm(temporary, { force: true });
    await plugin.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await restoreLinuxAppImage();
