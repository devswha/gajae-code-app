import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { BUN_VERSION } from '../fetch-bun.mjs';
import { sha256 } from '../runtime-archive.mjs';

export const NODE_VERSION = '22.22.2';
// https://nodejs.org/dist/v22.22.2/SHASUMS256.txt
export const NODE_ARCHIVE_SHA256 = '7c93e9d92bf68c07182b471aa187e35ee6cd08ef0f24ab060dfff605fcc1c57c';
export const NODE_ARCHIVE = `node-v${NODE_VERSION}-win-x64.zip`;
export const SIDECAR_NAME = 'gajae-app-server-x86_64-pc-windows-msvc.exe';
export const RUNTIME_DEPENDENCIES = [
  '@gajae-code/coding-agent', '@puppeteer/browsers', '@octokit/rest', '@vscode/ripgrep',
  'better-sqlite3', 'cors', 'cross-spawn', 'express', 'gray-matter', 'mime-types',
  'multer', 'node-pty', 'puppeteer-core', 'shell-quote', 'ws', 'zod',
];

export function assertWindowsHost(platform = process.platform, arch = process.arch) {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error(`Windows payload requires win32-x64; received ${platform}-${arch}.`);
  }
}

/** Keep the lockfile's exact runtime versions, including transitive runtime imports. */
export async function restrictRuntimeDependencies(payloadDir) {
  const manifestPath = path.join(payloadDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(payloadDir, 'package-lock.json'), 'utf8'));
  const dependencies = {};
  for (const name of RUNTIME_DEPENDENCIES) {
    const version = lock.packages?.[`node_modules/${name}`]?.version;
    if (!version) throw new Error(`Runtime dependency is missing from package-lock.json: ${name}`);
    dependencies[name] = version;
  }
  manifest.dependencies = dependencies;
  delete manifest.devDependencies;
  delete manifest.optionalDependencies;
  manifest.scripts = {};
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function pruneNonRuntimeMetadata(directory) {
  let removed = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) removed += await pruneNonRuntimeMetadata(target);
    else if (entry.isFile() && /(?:\.map|\.d\.(?:c|m)?ts)$/.test(entry.name)) {
      await fs.rm(target);
      removed += 1;
    }
  }
  return removed;
}

export async function assertWindowsX64Executable(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const dos = Buffer.alloc(64);
    const { bytesRead } = await handle.read(dos, 0, dos.length, 0);
    if (bytesRead !== dos.length || dos.toString('ascii', 0, 2) !== 'MZ') throw new Error('missing DOS header');
    const offset = dos.readUInt32LE(60);
    const pe = Buffer.alloc(6);
    if (offset < 64 || (await handle.read(pe, 0, pe.length, offset)).bytesRead !== pe.length
      || pe.readUInt32LE(0) !== 0x00004550 || pe.readUInt16LE(4) !== 0x8664) {
      throw new Error('missing x64 PE header');
    }
  } catch (error) {
    throw new Error(`Expected a Windows x64 executable at ${filePath}: ${error.message}`);
  } finally {
    await handle.close();
  }
}

export async function verifyManifest(payloadDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(payloadDir, 'server', 'gjc-runtime-manifest.json'), 'utf8'));
  const compiled = JSON.parse(await fs.readFile(path.join(payloadDir, 'dist-server', 'server', 'gjc-runtime-manifest.json'), 'utf8'));
  if (JSON.stringify(manifest) !== JSON.stringify(compiled)) throw new Error('Compiled runtime manifest is stale; run npm run build.');
  const files = manifest.platforms?.['win32-x64']?.files;
  if (manifest.bun !== BUN_VERSION || !Array.isArray(files) || !files.some(entry => entry.path?.endsWith('.node'))) {
    throw new Error('gjc-runtime-manifest is missing the pinned win32-x64 native closure.');
  }
  const versions = {
    '@gajae-code/coding-agent': manifest.gjcSdk,
    '@gajae-code/natives': manifest.natives,
    '@gajae-code/natives-win32-x64': manifest.natives,
  };
  for (const [name, expected] of Object.entries(versions)) {
    const installed = JSON.parse(await fs.readFile(path.join(payloadDir, 'node_modules', name, 'package.json'), 'utf8'));
    if (!expected || installed.name !== name || installed.version !== expected) throw new Error(`Runtime package version mismatch: ${name}`);
  }
  for (const entry of files) {
    if (!['@gajae-code/natives', '@gajae-code/natives-win32-x64'].includes(entry.package)
      || typeof entry.path !== 'string' || !entry.path.startsWith('native/')
      || entry.path.includes('\\') || entry.path.split('/').some(part => !part || part === '.' || part === '..')
      || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid native manifest entry.');
    const filePath = path.join(payloadDir, 'node_modules', entry.package, entry.path);
    if (await sha256(filePath) !== entry.sha256) throw new Error(`Manifest hash mismatch: ${entry.package}/${entry.path}`);
    if (entry.path.endsWith('.node')) await assertWindowsX64Executable(filePath);
  }
}

export async function verifyNode(binary, options = {}) {
  await assertWindowsX64Executable(binary);
  const { stdout } = await promisify(execFile)(binary, ['-p', 'JSON.stringify([process.platform, process.arch, process.version])'], {
    ...options, shell: false, windowsHide: true, timeout: 15_000,
  });
  if (stdout.trim() !== JSON.stringify(['win32', 'x64', `v${NODE_VERSION}`])) throw new Error('Pinned Windows Node runtime verification failed.');
}

/** Windows environment keys are case-insensitive; never retain both PATH and Path. */
export function windowsBuildEnvironment(nodeDirectory, inherited = process.env) {
  const env = { ...inherited };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path');
  const previous = pathKey ? env[pathKey] : '';
  for (const key of Object.keys(env)) {
    if (['path', 'node_path', 'node_options'].includes(key.toLowerCase())) delete env[key];
  }
  return { ...env, PATH: [nodeDirectory, previous].filter(Boolean).join(';'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
}

export function windowsSmokeEnvironment(nodeDirectory, stateDir, inherited = process.env) {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'SystemDrive', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']) {
    const key = Object.keys(inherited).find(key => key.toLowerCase() === name.toLowerCase());
    if (key) env[name] = inherited[key];
  }
  const systemRoot = env.SystemRoot || 'C:\\Windows';
  return {
    ...env,
    SystemRoot: systemRoot,
    PATH: [nodeDirectory, path.win32.join(systemRoot, 'System32'), systemRoot].join(';'),
    HOME: stateDir, USERPROFILE: stateDir,
    HOMEDRIVE: path.win32.parse(stateDir).root.replace(/\\$/, ''),
    HOMEPATH: stateDir.slice(path.win32.parse(stateDir).root.length - 1),
    APPDATA: path.join(stateDir, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(stateDir, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(stateDir, 'config'), XDG_DATA_HOME: path.join(stateDir, 'data'), XDG_CACHE_HOME: path.join(stateDir, 'cache'),
    TEMP: path.join(stateDir, 'tmp'), TMP: path.join(stateDir, 'tmp'),
    DATABASE_PATH: path.join(stateDir, 'auth.db'), GJC_WORKER_AGENT_DIR: path.join(stateDir, 'agent'),
    WORKSPACES_ROOT: path.join(stateDir, 'workspaces'), HOST: '127.0.0.1', NODE_ENV: 'production',
  };
}
