#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUN_VERSION, versionOf } from '../fetch-bun.mjs';
import { downloadVerifiedArchive, extractWindowsZip } from '../runtime-archive.mjs';

import { describeDistributionExclusions, removeExcludedDistributionPackages } from './distribution-exclusions.mjs';
import { smokeWindowsServer } from './smoke-windows-server.mjs';
import {
  assertWindowsHost, assertWindowsX64Executable, NODE_ARCHIVE, NODE_ARCHIVE_SHA256, NODE_VERSION,
  pruneNonRuntimeMetadata, restrictRuntimeDependencies, SIDECAR_NAME, verifyManifest, verifyNode, windowsBuildEnvironment,
} from './windows-payload.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INPUTS = [
  'dist', 'dist-server', 'shared', 'public', 'server/gjc-runtime-manifest.json',
  'scripts/gajae-app-runtime.mjs', 'package.json', 'package-lock.json',
  'dist-native/gajae-core.exe', 'dist-native/bun.exe', 'LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md',
];

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with code ${code}.`)));
  });
}

export async function buildWindowsServerPayload() {
  // This must run before inspecting or removing the shared macOS payload path.
  assertWindowsHost();
  const payloadDir = path.join(rootDir, 'src-tauri', 'resources', 'server-payload');
  const sidecarPath = path.join(rootDir, 'src-tauri', 'binaries', SIDECAR_NAME);
  for (const input of INPUTS) {
    try { await fs.access(path.join(rootDir, input)); }
    catch { throw new Error(`Missing Windows payload input ${input}. Run scripts/fetch-bun.mjs and npm run build on Windows x64 first.`); }
  }
  const coreSource = path.join(rootDir, 'dist-native', 'gajae-core.exe');
  const coreCargo = await fs.readFile(path.join(rootDir, 'native', 'gajae-core', 'Cargo.toml'), 'utf8');
  const coreVersion = /^version\s*=\s*"([^"]+)"/m.exec(coreCargo)?.[1];
  await assertWindowsX64Executable(coreSource);
  await assertWindowsX64Executable(path.join(rootDir, 'dist-native', 'bun.exe'));
  if (await versionOf(coreSource) !== `gajae-core ${coreVersion}`) throw new Error('Bundled gajae-core version mismatch.');
  if (await versionOf(path.join(rootDir, 'dist-native', 'bun.exe')) !== BUN_VERSION) throw new Error(`Bundled Bun must be ${BUN_VERSION}.`);
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae-windows-node-'));
  try {
    await fs.rm(payloadDir, { recursive: true, force: true });
    await fs.mkdir(payloadDir, { recursive: true });
    for (const input of INPUTS) {
      const destination = path.join(payloadDir, input);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.cp(path.join(rootDir, input), destination, { recursive: true });
    }
    const archive = path.join(temporaryDir, NODE_ARCHIVE);
    await downloadVerifiedArchive(`https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}`, archive, NODE_ARCHIVE_SHA256);
    await extractWindowsZip(archive, temporaryDir);
    const nodeDirectory = path.join(temporaryDir, `node-v${NODE_VERSION}-win-x64`);
    const payloadNode = path.join(nodeDirectory, 'node.exe');
    const env = windowsBuildEnvironment(nodeDirectory);
    await verifyNode(payloadNode, { env });
    const npmCli = path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    await restrictRuntimeDependencies(payloadDir);
    for (const args of [
      ['install', '--package-lock-only', '--ignore-scripts', '--omit=dev'],
      ['ci', '--omit=dev'],
      ['rebuild', '--omit=dev', '--build-from-source', 'better-sqlite3', 'node-pty'],
    ]) await run(payloadNode, [npmCli, ...args], { cwd: payloadDir, env });
    await verifyManifest(payloadDir);
    console.log(describeDistributionExclusions(await removeExcludedDistributionPackages(fs, path, path.join(payloadDir, 'node_modules'))));
    const pruned = await pruneNonRuntimeMetadata(path.join(payloadDir, 'node_modules'))
      + await pruneNonRuntimeMetadata(path.join(payloadDir, 'dist-server'));
    await fs.rm(path.join(payloadDir, 'package-lock.json'));
    // Preserve Node's upstream license without shipping the build-only npm distribution.
    await fs.copyFile(path.join(nodeDirectory, 'LICENSE'), path.join(payloadDir, 'NODE-LICENSE'));
    await fs.mkdir(path.dirname(sidecarPath), { recursive: true });
    await fs.copyFile(payloadNode, sidecarPath);
    await verifyNode(sidecarPath, { env });
    await smokeWindowsServer({ payloadDir, nodePath: sidecarPath });
    console.log(`Built and verified Windows x64 server payload at ${payloadDir}; sidecar ${sidecarPath}; pruned ${pruned} metadata files.`);
  } catch (error) {
    await fs.rm(payloadDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(sidecarPath, { force: true, maxRetries: 5, retryDelay: 200 });
    throw error;
  } finally {
    await fs.rm(temporaryDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildWindowsServerPayload();
