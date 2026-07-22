#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = '22.22.2';
const NODE_ARCHIVE_SHA256 = 'db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000';
const BUN_VERSION = '1.3.14';
const NATIVE_MODULES = ['better-sqlite3', 'node-pty'];
const RUNTIME_DEPENDENCIES = [
  '@gajae-code/coding-agent',
  '@octokit/rest',
  '@vscode/ripgrep',
  'better-sqlite3',
  'cors',
  'cross-spawn',
  'express',
  'gray-matter',
  'mime-types',
  'multer',
  'node-pty',
  'shell-quote',
  'ws',
];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const payloadDir = path.join(rootDir, 'src-tauri', 'resources', 'server-payload');
const sidecarDir = path.join(rootDir, 'src-tauri', 'binaries');
const sidecarPath = path.join(sidecarDir, 'gajae-app-server-aarch64-apple-darwin');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`)));
  });
}

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}: ${stderr}`)));
  });
}
async function stageSidecar(payloadNode) {
  await fs.mkdir(sidecarDir, { recursive: true });
  await fs.copyFile(payloadNode, sidecarPath);
  await fs.chmod(sidecarPath, 0o755);
  await codesign(sidecarPath);
  if ((await capture(sidecarPath, ['--version'])).trim() !== `v${NODE_VERSION}`) {
    throw new Error('Staged Tauri sidecar Node runtime version verification failed.');
  }
}


async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function sha256(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function copy(relativePath) {
  await fs.cp(path.join(rootDir, relativePath), path.join(payloadDir, relativePath), { recursive: true });
}

async function restrictRuntimeDependencies() {
  const packagePath = path.join(payloadDir, 'package.json');
  const lockPath = path.join(payloadDir, 'package-lock.json');
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  const packageLock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  const dependencies = {};

  for (const dependency of RUNTIME_DEPENDENCIES) {
    const declaredVersion = packageJson.dependencies?.[dependency];
    const lockedVersion = packageLock.packages?.[`node_modules/${dependency}`]?.version;
    if (!declaredVersion && !lockedVersion) throw new Error(`Runtime dependency is missing from package-lock.json: ${dependency}`);
    dependencies[dependency] = declaredVersion || lockedVersion;
  }

  packageJson.dependencies = dependencies;
  delete packageJson.devDependencies;
  delete packageJson.optionalDependencies;
  packageJson.scripts = {};
  await fs.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function pruneNonRuntimeMetadata(directory) {
  let removed = 0;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      removed += await pruneNonRuntimeMetadata(filePath);
    } else if (entry.isFile() && /(?:\.map|\.d\.(?:c|m)?ts)$/.test(entry.name)) {
      await fs.rm(filePath);
      removed += 1;
    }
  }
  return removed;
}

async function downloadPinnedNode() {
  const archiveName = `node-v${NODE_VERSION}-darwin-arm64.tar.gz`;
  const archive = path.join(os.tmpdir(), archiveName);
  const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`);
  if (!response.ok || !response.body) throw new Error(`Node download failed with HTTP ${response.status}.`);
  const chunks = [];
  for await (const chunk of response.body) chunks.push(chunk);
  await fs.writeFile(archive, Buffer.concat(chunks), { mode: 0o600 });
  if (await sha256(archive) !== NODE_ARCHIVE_SHA256) throw new Error('Pinned Node archive failed SHA-256 verification.');
  await run('tar', ['-xzf', archive, '-C', payloadDir]);
  await fs.rm(archive, { force: true });
  const extracted = path.join(payloadDir, `node-v${NODE_VERSION}-darwin-arm64`);
  await fs.rename(extracted, path.join(payloadDir, 'node'));
}

async function required(relativePaths) {
  const missing = [];
  for (const relativePath of relativePaths) if (!(await exists(path.join(rootDir, relativePath)))) missing.push(relativePath);
  if (missing.length) throw new Error(`Missing payload inputs: ${missing.join(', ')}. Run npm run build first.`);
}

async function codesign(filePath) {
  await run('codesign', ['--force', '--sign', '-', '--timestamp=none', filePath]);
}

async function codesignNativeClosure(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (filePath.includes(`${path.sep}node_modules${path.sep}@gajae-code${path.sep}`)) continue;
      await codesignNativeClosure(filePath);
    } else if (entry.isFile() && (entry.name.endsWith('.node') || filePath.endsWith('/bun') || filePath.endsWith('/gajae-core') || filePath.endsWith('/node'))) await codesign(filePath);
  }
}

async function verifyManifest() {
  const manifest = JSON.parse(await fs.readFile(path.join(payloadDir, 'server', 'gjc-runtime-manifest.json'), 'utf8'));
  const closure = manifest.platforms?.['darwin-arm64']?.files;
  if (!Array.isArray(closure) || closure.length === 0) throw new Error('gjc-runtime-manifest is missing the darwin-arm64 native closure.');
  for (const entry of closure) {
    const filePath = path.join(payloadDir, 'node_modules', entry.package, entry.path);
    if (!(await exists(filePath))) throw new Error(`Missing manifest native payload file: ${entry.package}/${entry.path}`);
    if (await sha256(filePath) !== entry.sha256) throw new Error(`Manifest hash mismatch: ${entry.package}/${entry.path}`);
  }
}

async function smoke(payloadNode) {
  const smoke = `
    import { createRequire } from 'node:module';
    import { spawn, spawnSync } from 'node:child_process';
    import { mkdtemp, rm } from 'node:fs/promises';
    import os from 'node:os';
    import path from 'node:path';
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    const pty = require('node-pty');
    const database = new Database(':memory:');
    if (database.prepare('SELECT 22 AS value').get().value !== 22) throw new Error('better-sqlite3 smoke failed');
    database.close();
    await new Promise((resolve, reject) => {
      const terminal = pty.spawn(process.execPath, ['-e', 'process.exit(0)'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
      const timer = setTimeout(() => { terminal.kill(); reject(new Error('PTY timed out')); }, 5000);
      terminal.onExit(({ exitCode }) => { clearTimeout(timer); exitCode === 0 ? resolve() : reject(new Error('PTY exited ' + exitCode)); });
    });
    const bun = path.join(process.cwd(), 'dist-native', 'bun');
    if (spawnSync(bun, ['--version'], { encoding: 'utf8' }).stdout.trim() !== '${BUN_VERSION}') throw new Error('Bundled Bun version mismatch');
    const agentDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-payload-agent-'));
    await new Promise((resolve, reject) => {
      const worker = spawn(bun, [path.join(process.cwd(), 'dist-server/server/gjc-bun-worker.js')], { env: { ...process.env, GJC_WORKER_AGENT_DIR: agentDir }, stdio: ['pipe', 'pipe', 'pipe'] });
      let buffered = ''; let initialized = false; let shutdown = false; let stderr = '';
      const timer = setTimeout(() => { worker.kill(); reject(new Error('Bun worker timed out: ' + stderr + buffered)); }, 10000);
      const fail = (error) => { clearTimeout(timer); worker.kill(); reject(error); };
      worker.stdout.setEncoding('utf8'); worker.stderr.setEncoding('utf8');
      worker.stderr.on('data', chunk => { stderr += chunk; });
      worker.stdout.on('data', chunk => { buffered += chunk; const lines = buffered.split('\\n'); buffered = lines.pop(); try { for (const line of lines) { if (!line) continue; const frame = JSON.parse(line); if (frame.id === 'init' && frame.payload?.ok === true) { initialized = true; worker.stdin.write(JSON.stringify({ protocolVersion: 1, kind: 'request', id: 'shutdown', method: 'worker.shutdown', payload: {} }) + '\\n'); worker.stdin.end(); } else if (frame.id === 'shutdown' && frame.payload?.ok === true) shutdown = true; } } catch (error) { fail(error); } });
      worker.once('error', fail); worker.once('close', code => { clearTimeout(timer); code === 0 && initialized && shutdown && !stderr ? resolve() : reject(new Error('Bun worker handshake failed: ' + stderr)); });
      setTimeout(() => worker.stdin.write(JSON.stringify({ protocolVersion: 1, kind: 'request', id: 'init', method: 'worker.initialize', payload: {} }) + '\\n'), 25);
    });
    await rm(agentDir, { recursive: true, force: true });
    const port = 39000 + Math.floor(Math.random() * 1000);
    const server = spawn(process.execPath, ['dist-server/server/index.js'], { env: { ...process.env, PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', SERVER_PORT: String(port), HOST: '127.0.0.1', GJC_WORKER_AGENT_DIR: agentDir }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; server.stdout.setEncoding('utf8'); server.stderr.setEncoding('utf8'); server.stdout.on('data', chunk => { output += chunk; }); server.stderr.on('data', chunk => { output += chunk; });
    try { let health; for (let attempt = 0; attempt < 50; attempt += 1) { try { health = await fetch('http://127.0.0.1:' + port + '/health'); if (health.ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } if (!health?.ok) throw new Error('Payload health check failed: ' + output); } finally { server.kill('SIGTERM'); await new Promise(resolve => server.once('close', resolve)); }
  `;
  await run(payloadNode, ['--input-type=module', '--eval', smoke], { cwd: payloadDir, env: { ...process.env, PATH: `${path.dirname(payloadNode)}:/usr/bin:/bin` } });
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error(`macOS payload requires darwin-arm64; received ${process.platform}-${process.arch}.`);
await required(['dist', 'dist-server', 'shared', 'public', 'package.json', 'package-lock.json', 'server/gjc-runtime-manifest.json', 'scripts/fix-node-pty.js', 'dist-native/gajae-core', 'dist-native/bun']);
await fs.rm(payloadDir, { recursive: true, force: true });
await fs.mkdir(payloadDir, { recursive: true });
try {
  for (const input of ['dist', 'dist-server', 'shared', 'public', 'server/gjc-runtime-manifest.json', 'scripts/fix-node-pty.js', 'scripts/gajae-app-runtime.mjs', 'package.json', 'package-lock.json', 'dist-native']) await copy(input);
  await downloadPinnedNode();
  const payloadNode = path.join(payloadDir, 'node', 'bin', 'node');
  if ((await capture(payloadNode, ['--version'])).trim() !== `v${NODE_VERSION}`) throw new Error('Pinned Node runtime version verification failed.');
  const payloadNodeBin = path.dirname(payloadNode);
  const npmEnvironment = { ...process.env, PATH: `${payloadNodeBin}:/usr/bin:/bin`, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
  const npmCli = path.join(payloadDir, 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  await restrictRuntimeDependencies();
  await run(payloadNode, [npmCli, 'install', '--package-lock-only', '--ignore-scripts', '--omit=dev'], { cwd: payloadDir, env: npmEnvironment });
  await run(payloadNode, [npmCli, 'ci', '--omit=dev'], { cwd: payloadDir, env: npmEnvironment });
  await run(payloadNode, [npmCli, 'rebuild', '--omit=dev', '--build-from-source', ...NATIVE_MODULES], { cwd: payloadDir, env: { ...npmEnvironment, npm_config_build_from_source: 'true' } });
  await run(payloadNode, [path.join(payloadDir, 'scripts', 'fix-node-pty.js')], { cwd: payloadDir, env: npmEnvironment });
  await verifyManifest();
  const prunedMetadataFiles = await pruneNonRuntimeMetadata(path.join(payloadDir, 'node_modules'));
  await codesignNativeClosure(payloadDir);
  await stageSidecar(payloadNode);
  await fs.rm(path.join(payloadDir, 'package-lock.json'), { force: true });
  await fs.rm(path.join(payloadDir, 'scripts', 'fix-node-pty.js'), { force: true });
  await smoke(sidecarPath);
  await fs.rm(path.join(payloadDir, 'node'), { recursive: true, force: true });
  console.log(`Built and verified macOS server payload at ${path.relative(rootDir, payloadDir)}; pruned ${prunedMetadataFiles} non-runtime metadata files.`);
} catch (error) {
  await fs.rm(payloadDir, { recursive: true, force: true });
  await fs.rm(sidecarPath, { force: true });
  throw error;
}
