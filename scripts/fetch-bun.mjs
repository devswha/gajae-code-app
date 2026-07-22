#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const BUN_VERSION = '1.3.14';
const RELEASE_BASE_URL = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}`;
const PLATFORMS = {
  'linux-x64': {
    archive: 'bun-linux-x64.zip',
    archiveSha256: '951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f',
    binary: 'bun-linux-x64/bun',
  },
  'darwin-arm64': {
    archive: 'bun-darwin-aarch64.zip',
    archiveSha256: 'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620',
    binary: 'bun-darwin-aarch64/bun',
  },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const destination = path.join(rootDir, 'dist-native', 'bun');
const platformKey = `${process.platform}-${process.arch}`;
const platform = PLATFORMS[platformKey];

async function versionOf(binary) {
  return new Promise((resolve) => {
    const child = spawn(binary, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', () => resolve(null));
    child.once('exit', (code) => resolve(code === 0 ? output.trim() : null));
  });
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

async function download(url, destinationPath) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Bun download failed with HTTP ${response.status}.`);
  }
  const handle = await fs.open(destinationPath, 'w', 0o600);
  try {
    for await (const chunk of response.body) {
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
}

async function extractBinary(archivePath, archiveBinaryPath, destinationPath) {
  const output = createWriteStream(destinationPath, { mode: 0o700 });
  const child = spawn('unzip', ['-p', archivePath, archiveBinaryPath], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`unzip could not extract the Bun binary (exit code ${code}).`));
    });
  });
  await Promise.all([pipeline(child.stdout, output), exited]);
}

if (!platform) {
  throw new Error(`Bun ${BUN_VERSION} is only bundled for linux-x64 and darwin-arm64; received ${platformKey}.`);
}

if (await versionOf(destination) === BUN_VERSION) {
  console.log(`Bun ${BUN_VERSION} is already available at dist-native/bun.`);
  process.exit(0);
}

await fs.mkdir(path.dirname(destination), { recursive: true });
const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae-bun-'));
const archivePath = path.join(temporaryDir, platform.archive);
const temporaryBinary = path.join(path.dirname(destination), `.bun-${process.pid}.tmp`);

try {
  console.log(`Downloading Bun ${BUN_VERSION} for ${platformKey}...`);
  await download(`${RELEASE_BASE_URL}/${platform.archive}`, archivePath);
  const digest = await sha256(archivePath);
  if (digest !== platform.archiveSha256) {
    throw new Error('Downloaded Bun archive failed SHA-256 verification.');
  }

  await extractBinary(archivePath, platform.binary, temporaryBinary);
  await fs.chmod(temporaryBinary, 0o755);
  if (await versionOf(temporaryBinary) !== BUN_VERSION) {
    throw new Error('Extracted Bun binary did not report the requested version.');
  }
  await fs.rename(temporaryBinary, destination);
  console.log(`Installed Bun ${BUN_VERSION} at dist-native/bun.`);
} finally {
  await fs.rm(temporaryBinary, { force: true });
  await fs.rm(temporaryDir, { recursive: true, force: true });
}
