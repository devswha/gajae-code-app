#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const bunPath = path.join(rootDir, 'dist-native', process.platform === 'win32' ? 'bun.exe' : 'bun');
const manifestPath = path.join(rootDir, 'server', 'gjc-runtime-manifest.json');
const resolverFrom = path.join(rootDir, 'server');
const update = process.argv.slice(2).includes('--update');
// Runtime v2 supports Linux x64 and macOS arm64 only; Windows remains intentionally frozen out.
const SUPPORTED_PLATFORMS = new Set(['linux-x64', 'darwin-arm64']);

if (process.argv.slice(2).some((argument) => argument !== '--update')) {
  throw new Error('Usage: node scripts/fill-runtime-manifest.mjs [--update]');
}

async function packageRoot(entrypoint, expectedName) {
  let directory = path.dirname(entrypoint);
  while (directory !== path.dirname(directory)) {
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
      if (metadata.name === expectedName) return directory;
    } catch {
      // Continue towards the resolved package root.
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Could not locate ${expectedName} package root.`);
}

async function nativesEntrypoint() {
  const source = `console.log(Bun.resolveSync('@gajae-code/natives', ${JSON.stringify(resolverFrom)}));`;
  const { stdout } = await execFile(bunPath, ['--eval', source], { cwd: rootDir });
  const entrypoint = stdout.trim();
  if (!path.isAbsolute(entrypoint) || entrypoint.includes('\n')) {
    throw new Error('Bun did not resolve @gajae-code/natives to an absolute entrypoint path.');
  }
  return entrypoint;
}

async function sha256(pathname) {
  return crypto.createHash('sha256').update(await fs.readFile(pathname)).digest('hex');
}

async function closureFiles(packageName, packageRoot, filenames) {
  return Promise.all(filenames.sort().map(async (filename) => ({
    package: packageName,
    path: filename,
    sha256: await sha256(path.join(packageRoot, filename)),
  })));
}

async function platformClosure(nativesRoot, platform) {
  const platformPackage = `@gajae-code/natives-${platform}`;
  const platformRoot = path.join(path.dirname(nativesRoot), `natives-${platform}`);
  const metadata = JSON.parse(await fs.readFile(path.join(platformRoot, 'package.json'), 'utf8'));
  if (metadata.name !== platformPackage) throw new Error(`Invalid platform package at ${platformRoot}.`);

  const loaderFiles = (await fs.readdir(path.join(nativesRoot, 'native')))
    .filter((filename) => filename.endsWith('.js'))
    .map((filename) => path.join('native', filename));
  const addonFiles = (await fs.readdir(path.join(platformRoot, 'native')))
    .filter((filename) => filename.endsWith('.node'))
    .map((filename) => path.join('native', filename));
  if (addonFiles.length === 0) throw new Error(`${platformPackage} has no native addons.`);

  const files = [
    ...await closureFiles('@gajae-code/natives', nativesRoot, loaderFiles),
    ...await closureFiles(platformPackage, platformRoot, addonFiles),
  ];
  return { files: files.sort((left, right) => `${left.package}/${left.path}`.localeCompare(`${right.package}/${right.path}`)) };
}

const manifestText = await fs.readFile(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);
const nativesRoot = await packageRoot(await nativesEntrypoint(), '@gajae-code/natives');
const currentPlatform = `${process.platform}-${process.arch}`;
if (!SUPPORTED_PLATFORMS.has(currentPlatform)) {
  throw new Error(`GJC runtime manifest does not support ${currentPlatform}.`);
}
const actualCurrentClosure = await platformClosure(nativesRoot, currentPlatform);

if (!update) {
  if (JSON.stringify(manifest.platforms?.[currentPlatform]) !== JSON.stringify(actualCurrentClosure)) {
    console.error(`GJC runtime manifest closure does not match ${currentPlatform}; run npm run fill:runtime-manifest -- --update.`);
    process.exitCode = 1;
  } else {
    console.log(`Verified GJC runtime manifest closure: ${currentPlatform}`);
  }
} else {
  manifest.platforms ??= {};
  manifest.platforms[currentPlatform] = actualCurrentClosure;
  for (const platform of SUPPORTED_PLATFORMS) {
    manifest.platforms[platform] ??= { files: [] };
  }
  for (const platform of Object.keys(manifest.platforms)) {
    if (!SUPPORTED_PLATFORMS.has(platform)) delete manifest.platforms[platform];
  }
  delete manifest.nativesSha256;
  const updatedText = `${JSON.stringify(manifest, null, 2)}\n`;
  if (updatedText !== manifestText) await fs.writeFile(manifestPath, updatedText);
  console.log(`${updatedText === manifestText ? 'Verified' : 'Updated'} GJC runtime manifest closure: ${currentPlatform}`);
}
