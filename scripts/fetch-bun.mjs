#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const BUN_VERSION = '1.4.0';
const RELEASE_BASE_URL = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}`;
/**
 * `binarySha256` is the extracted executable, not just the archive.
 *
 * A Bun that is already on disk used to be accepted on the strength of what
 * `bun --version` printed, which is a string any executable can print. The
 * binary that actually runs every `*.bun.test.ts` and the packaged worker is
 * now compared to the bytes this pin describes; the archive hash stays because
 * it is what a download is checked against before anything is extracted.
 */
const PLATFORMS = {
  'linux-x64': {
    archive: 'bun-linux-x64.zip',
    archiveSha256: '2d03fb5fb83ac8b567aca0a281b2ce1a1a19d488f56c2968d88c3f25e92fe452',
    binary: 'bun-linux-x64/bun',
    binarySha256: '33d56b070be6a9e3da0ab013038b43d1645d0534ca811ecdba4472599117eb4b',
  },
  'darwin-arm64': {
    archive: 'bun-darwin-aarch64.zip',
    archiveSha256: 'c669e97f6164e1c96e0701748db98dfa77492908cbd8394c7557134a735de381',
    binary: 'bun-darwin-aarch64/bun',
    binarySha256: '539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf',
  },
  'linux-arm64': {
    archive: 'bun-linux-aarch64.zip',
    archiveSha256: '4b1a332ee861983eb93bcfe6f770fff94e3e31b2c388bdaea3c8ed35e58eed0e',
    binary: 'bun-linux-aarch64/bun',
    binarySha256: '086c4121c8738a8e0f5ed730e8a461bc3973b4444e372ddb77aef9a747fa2ae9',
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
  throw new Error(`Bun ${BUN_VERSION} is only bundled for linux-x64, darwin-arm64 and linux-arm64; received ${platformKey}.`);
}

const installedDigest = await fs.access(destination).then(() => sha256(destination), () => null);
if (installedDigest === platform.binarySha256) {
  console.log(`Bun ${BUN_VERSION} is already available at dist-native/bun.`);
  process.exit(0);
}
if (installedDigest !== null) {
  console.log(`Replacing dist-native/bun: its SHA-256 is ${installedDigest}, not the pinned ${platform.binarySha256}.`);
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
  if (await sha256(temporaryBinary) !== platform.binarySha256) {
    throw new Error('Extracted Bun binary does not match its pinned SHA-256.');
  }
  if (await versionOf(temporaryBinary) !== BUN_VERSION) {
    throw new Error('Extracted Bun binary did not report the requested version.');
  }
  await fs.rename(temporaryBinary, destination);
  console.log(`Installed Bun ${BUN_VERSION} at dist-native/bun.`);
} finally {
  await fs.rm(temporaryBinary, { force: true });
  await fs.rm(temporaryDir, { recursive: true, force: true });
}
