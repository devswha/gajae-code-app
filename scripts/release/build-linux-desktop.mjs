#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { lstat, readFile, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { desktopPlatform, desktopTargetDirectory, linuxDebDependencies } from './desktop-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`)));
  });
}

async function assertOwnedBundle(bundle, { name, productName }) {
  const refuse = relative => { throw new Error(`Refusing to clean unowned Linux bundle path: ${path.join(bundle, relative)}. Use a dedicated CARGO_TARGET_DIR for this app.`); };
  let root;
  try { root = await lstat(bundle); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!root.isDirectory()) refuse('');
  const versioned = filename => filename.startsWith(`${productName}_`)
    && /^[0-9A-Za-z][0-9A-Za-z.+-]*_amd64$/.test(filename.slice(productName.length + 1));
  const trees = [`appimage/${productName}.AppDir`, `appimage_deb/data/usr/lib/${productName}`];
  const files = [
    `appimage_deb/data/usr/bin/${name}-desktop`, `appimage_deb/data/usr/bin/${name}-server`,
    `appimage_deb/data/usr/share/applications/${productName}.desktop`,
  ];
  const icons = 'appimage_deb/data/usr/share/icons/hicolor';
  const parents = new Set(['deb', 'appimage', icons]);
  for (const leaf of [...trees, ...files, icons]) {
    for (let parent = path.posix.dirname(leaf); parent !== '.'; parent = path.posix.dirname(parent)) parents.add(parent);
  }
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(bundle, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      // Stop at product-owned subtrees; their payloads legitimately contain
      // arbitrary dependency files and symlinks. Shared staging paths do not.
      if (entry.isDirectory() && (trees.includes(child) || (relative === 'deb' && versioned(entry.name)))) continue;
      const packageFile = relative === 'deb' && /\.deb(?:\.sha256)?$/.test(entry.name)
        && versioned(entry.name.replace(/\.deb(?:\.sha256)?$/, ''));
      const imageFile = relative === 'appimage' && /\.AppImage(?:\.sig|\.sha256|\.restored-\d+)?$/.test(entry.name)
        && versioned(entry.name.replace(/\.AppImage(?:\.sig|\.sha256|\.restored-\d+)?$/, ''));
      const iconDirectory = relative.startsWith(`${icons}/`) && /^\d+x\d+(?:@\d+)?\/apps$/.test(relative.slice(icons.length + 1));
      if (entry.isFile() && (files.includes(child) || packageFile || imageFile || (iconDirectory && entry.name === `${name}-desktop.png`))) continue;
      if (entry.isDirectory() && (parents.has(child)
        || (child.startsWith(`${icons}/`) && /^\d+x\d+(?:@\d+)?(?:\/apps)?$/.test(child.slice(icons.length + 1))))) {
        await visit(child);
      } else refuse(child);
    }
  }
  await visit();
}

export async function buildLinuxDesktop({ rootDir = root, inheritedEnv = process.env, execute = run } = {}) {
  const desktop = desktopPlatform();
  if (desktop.key !== 'linux-x64') throw new Error('Build Linux desktop packages on a Linux x64 host.');
  linuxDebDependencies([]); // Reject musl before building or removing anything.
  const env = { ...inheritedEnv, APPIMAGE_EXTRACT_AND_RUN: inheritedEnv.APPIMAGE_EXTRACT_AND_RUN || '1' };
  delete env.CI;
  const targetDir = await desktopTargetDirectory(rootDir, env);
  const releaseDir = path.join(targetDir, desktop.target, 'release');
  const bundle = path.join(releaseDir, 'bundle');
  const identity = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
  // Cargo caches may be shared across applications. Refuse foreign contents
  // before the payload build changes anything, including common appimage_deb.
  await assertOwnedBundle(bundle, identity);
  const options = { cwd: rootDir, env };
  await execute('npm', ['run', 'server:payload:linux'], options);
  await assertOwnedBundle(bundle, identity);
  // Tauri reuses AppDir, appimage_deb and copied Cargo resource trees. Remove
  // stale inputs in the actual Cargo output, including configured target dirs.
  await rm(path.join(releaseDir, 'resources', 'server-payload'), { recursive: true, force: true });
  await rm(bundle, { recursive: true, force: true });
  await execute('npm', ['run', 'tauri', '--', 'build', '--bundles', 'deb,appimage', '--', '--locked'], options);
  await execute(process.execPath, [path.join(rootDir, 'scripts', 'release', 'restore-linux-appimage.mjs')], options);
  await execute(process.execPath, [path.join(rootDir, 'scripts', 'release', 'stage-linux-desktop.mjs')], options);
}

if (process.argv[1] && await realpath(fileURLToPath(import.meta.url)) === await realpath(process.argv[1])) await buildLinuxDesktop();
