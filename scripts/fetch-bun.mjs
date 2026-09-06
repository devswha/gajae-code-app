#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

import { downloadVerifiedArchive, extractWindowsZip } from './runtime-archive.mjs';

export const BUN_VERSION = '1.4.0';
const RELEASE_BASE_URL = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}`;
export const PLATFORMS = {
  'linux-x64': {
    archive: 'bun-linux-x64.zip',
    archiveSha256: '2d03fb5fb83ac8b567aca0a281b2ce1a1a19d488f56c2968d88c3f25e92fe452',
    binary: 'bun-linux-x64/bun',
  },
  'darwin-arm64': {
    archive: 'bun-darwin-aarch64.zip',
    archiveSha256: 'c669e97f6164e1c96e0701748db98dfa77492908cbd8394c7557134a735de381',
    binary: 'bun-darwin-aarch64/bun',
  },
  'win32-x64': {
    archive: 'bun-windows-x64.zip',
    // https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/SHASUMS256.txt
    archiveSha256: 'e6f093d39da486b20262ca8cdd5ed6a9e8bc9c2f275b78e6d3a0c5b28cc95901',
    binary: 'bun-windows-x64/bun.exe',
  },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const WINDOWS_FILE_OPERATION_MAX_ATTEMPTS = 4;
const WINDOWS_FILE_OPERATION_RETRY_DELAY_MS = 100;
const WINDOWS_TRANSIENT_FILE_ERRORS = new Set(['EBUSY', 'EPERM', 'EACCES']);

export async function versionOf(binary) {
  return new Promise((resolve) => {
    const child = spawn(binary, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 15_000 });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', () => resolve(null));
    child.once('close', (code) => resolve(code === 0 ? output.trim() : null));
  });
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isTransientWindowsFileError(error) {
  return WINDOWS_TRANSIENT_FILE_ERRORS.has(error?.code);
}

async function runFileOperation(operation, windows, retrySleep) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!windows || !isTransientWindowsFileError(error) || attempt >= WINDOWS_FILE_OPERATION_MAX_ATTEMPTS) {
        throw error;
      }
      await retrySleep(WINDOWS_FILE_OPERATION_RETRY_DELAY_MS);
    }
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function extractBinary(archivePath, archiveBinaryPath, destinationPath, platformKey) {
  if (platformKey.startsWith('win32-')) {
    const directory = path.join(path.dirname(archivePath), 'extracted');
    await extractWindowsZip(archivePath, directory);
    await fs.copyFile(path.join(directory, ...archiveBinaryPath.split('/')), destinationPath);
    return;
  }
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

export async function fetchBun({
  root = rootDir,
  platformKey = `${process.platform}-${process.arch}`,
  download = downloadVerifiedArchive,
  extract = extractBinary,
  probe = versionOf,
  fsModule = fs,
  retrySleep = wait,
} = {}) {
  const platform = PLATFORMS[platformKey];
  if (!platform) {
    throw new Error(`Bun ${BUN_VERSION} is only bundled for ${Object.keys(PLATFORMS).join(', ')}; received ${platformKey}.`);
  }
  const windows = platformKey.startsWith('win32-');
  const destination = path.join(root, 'dist-native', windows ? 'bun.exe' : 'bun');
  if (await probe(destination) === BUN_VERSION) {
    console.log(`Bun ${BUN_VERSION} is already available at ${destination}.`);
    return destination;
  }
  await fsModule.mkdir(path.dirname(destination), { recursive: true });
  const temporaryDir = await fsModule.mkdtemp(path.join(os.tmpdir(), 'gajae-bun-'));
  const archivePath = path.join(temporaryDir, platform.archive);
  // Windows CreateProcess needs the executable suffix even before installation.
  const temporaryBinary = path.join(path.dirname(destination), `.bun-${path.basename(temporaryDir)}.tmp${windows ? '.exe' : ''}`);

  let failure;
  try {
    console.log(`Downloading Bun ${BUN_VERSION} for ${platformKey}...`);
    await download(`${RELEASE_BASE_URL}/${platform.archive}`, archivePath, platform.archiveSha256);
    await extract(archivePath, platform.binary, temporaryBinary, platformKey);
    if (!windows) await fsModule.chmod(temporaryBinary, 0o755);
    if (await probe(temporaryBinary) !== BUN_VERSION) {
      throw new Error('Extracted Bun binary did not report the requested version.');
    }
    await runFileOperation(() => fsModule.rename(temporaryBinary, destination), windows, retrySleep);
  } catch (error) {
    failure = error;
  }

  const cleanupErrors = [];
  try {
    await runFileOperation(() => fsModule.rm(temporaryBinary, { force: true }), windows, retrySleep);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await runFileOperation(() => fsModule.rm(temporaryDir, { recursive: true, force: true }), windows, retrySleep);
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (failure) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [failure, ...cleanupErrors],
        `${errorMessage(failure)}\nBun temporary cleanup also failed: ${cleanupErrors.map(errorMessage).join('\n')}`,
      );
    }
    throw failure;
  }
  if (cleanupErrors.length > 0) {
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    throw new AggregateError(cleanupErrors, `Bun temporary cleanup failed: ${cleanupErrors.map(errorMessage).join('\n')}`);
  }
  console.log(`Installed Bun ${BUN_VERSION} at ${destination}.`);
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await fetchBun();
