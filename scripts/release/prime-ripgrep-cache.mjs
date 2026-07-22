#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const packageLock = JSON.parse(await readFile(join(rootDir, 'package-lock.json'), 'utf8'));
const ripgrepPackageVersion = packageLock.packages?.['node_modules/@vscode/ripgrep']?.version;

if (ripgrepPackageVersion !== '1.17.1') {
  throw new Error(`Update the verified ripgrep cache contract for @vscode/ripgrep ${ripgrepPackageVersion ?? 'missing'}.`);
}

const releaseVersion = 'v15.0.1';
const targets = new Map([
  ['darwin-arm64', {
    target: 'aarch64-apple-darwin',
    sha256: '2fa16464fd8638588a67c7fc172d3c4b57fbdc65dff366e10b0b0e90734628a6',
  }],
  ['linux-x64', {
    target: 'x86_64-unknown-linux-musl',
    sha256: '4499958bfd5252df3d9e7504127fd448e4a14fbf2805ef4f14baaa1bcf775188',
  }],
]);
const selected = targets.get(`${process.platform}-${process.arch}`);

if (!selected) {
  throw new Error(`No verified ripgrep release cache is defined for ${process.platform}-${process.arch}.`);
}

const assetName = `ripgrep-${releaseVersion}-${selected.target}.tar.gz`;
const assetUrl = `https://github.com/microsoft/ripgrep-prebuilt/releases/download/${releaseVersion}/${assetName}`;
const cacheDir = join(tmpdir(), `vscode-ripgrep-cache-${ripgrepPackageVersion}`);
const cachePath = join(cacheDir, assetName);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function validCachedAsset() {
  try {
    return digest(await readFile(cachePath)) === selected.sha256;
  } catch {
    return false;
  }
}

await mkdir(cacheDir, { recursive: true });
if (await validCachedAsset()) {
  console.log(`Verified ripgrep cache already exists: ${cachePath}`);
  process.exit(0);
}

let lastError;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
  try {
    const response = await fetch(assetUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actualSha256 = digest(bytes);
    if (actualSha256 !== selected.sha256) {
      throw new Error(`Checksum mismatch: expected ${selected.sha256}, received ${actualSha256}.`);
    }
    await writeFile(temporaryPath, bytes, { mode: 0o600 });
    await rename(temporaryPath, cachePath);
    console.log(`Seeded verified ripgrep cache: ${cachePath}`);
    process.exit(0);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    lastError = error;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
}

throw lastError;
