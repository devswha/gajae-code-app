#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { desktopTargetDirectory } from './desktop-platforms.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function artifactIn(directory, extension, expectedName) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing ${extension} artifact directory: ${directory}`);
    throw error;
  }
  const candidates = entries.filter(entry => !entry.isDirectory() && entry.name.endsWith(extension));
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one ${extension} artifact in ${directory}; found ${candidates.length}${candidates.length ? `: ${candidates.map(entry => entry.name).sort().join(', ')}` : ''}`);
  }
  const candidate = candidates[0];
  if (candidate.name !== expectedName) throw new Error(`Unexpected ${extension} artifact: ${candidate.name}; expected ${expectedName}.`);
  if (!candidate.isFile()) throw new Error(`Artifact must be a regular file: ${path.join(directory, candidate.name)}`);
  const source = path.join(directory, candidate.name);
  const { mode, size } = await stat(source);
  if (!size) throw new Error(`Artifact is empty: ${source}`);
  if (extension === '.AppImage' && !(mode & 0o111)) throw new Error(`AppImage is not executable: ${source}`);
  return { source, mode: mode & 0o777, extension };
}

export async function stageLinuxDesktop({ rootDir = repositoryRoot, targetDir } = {}) {
  const { version, productName, desktopVersion } = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
  if (typeof version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version) || version.includes('..')) {
    throw new Error(`Invalid release artifact version: ${version}`);
  }
  const bundle = path.join(targetDir || await desktopTargetDirectory(rootDir), 'x86_64-unknown-linux-gnu', 'release', 'bundle');
  const artifactName = `${productName}_${desktopVersion}_amd64`;
  // Validate both formats before replacing any previously staged release.
  const sources = [
    await artifactIn(path.join(bundle, 'deb'), '.deb', `${artifactName}.deb`),
    await artifactIn(path.join(bundle, 'appimage'), '.AppImage', `${artifactName}.AppImage`),
  ];
  const outputDir = path.join(rootDir, 'release', 'desktop');
  await mkdir(outputDir, { recursive: true });
  const temporaryDir = await mkdtemp(path.join(outputDir, '.linux-stage-'));
  try {
    const artifacts = [];
    for (const { source, mode, extension } of sources) {
      const filename = `gajae-app-desktop-${version}-linux-x64${extension}`;
      const staged = path.join(temporaryDir, filename);
      await copyFile(source, staged);
      await chmod(staged, mode);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(staged)) hash.update(chunk);
      const sha256 = hash.digest('hex');
      await writeFile(`${staged}.sha256`, `${sha256}  ${filename}\n`);
      artifacts.push({ source, artifact: path.join(outputDir, filename), sha256, shaFile: path.join(outputDir, `${filename}.sha256`) });
    }
    for (const { artifact, shaFile } of artifacts) {
      await rename(path.join(temporaryDir, path.basename(artifact)), artifact);
      await rename(path.join(temporaryDir, path.basename(shaFile)), shaFile);
    }
    return { ok: true, version, artifacts };
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && await realpath(fileURLToPath(import.meta.url)) === await realpath(process.argv[1])) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/release/stage-linux-desktop.mjs');
  console.log(JSON.stringify(await stageLinuxDesktop(), null, 2));
}
