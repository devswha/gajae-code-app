#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_NODE_MAJOR = 22;
const TARGET_NODE_VERSION = [22, 22, 2];
const TARGET_GLIBC_VERSION = [2, 35, 0];
const TARGET_PLATFORM = 'linux';
const TARGET_ARCH = 'x64';
const NATIVE_MODULES = ['better-sqlite3', 'node-pty'];
const BUN_VERSION = '1.3.14';
const GJC_SDK_PACKAGE = '@gajae-code/coding-agent';
const GJC_NATIVES_PACKAGE = '@gajae-code/natives';
const GJC_SDK_VERSION = '0.11.1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/u.exec(value || '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : null;
}

function isAtLeastVersion(actual, minimum) {
  return actual.some((part, index) => (
    part > minimum[index] &&
    actual.slice(0, index).every((value, prior) => value === minimum[prior])
  )) || actual.every((part, index) => part === minimum[index]);
}

function assertTargetEnvironment() {
  if (process.platform !== TARGET_PLATFORM) {
    throw new Error(`Server bundles must be built on ${TARGET_PLATFORM}; received ${process.platform}.`);
  }
  if (process.arch !== TARGET_ARCH) {
    throw new Error(`Server bundles must be built for ${TARGET_ARCH}; received ${process.arch}.`);
  }

  const nodeVersion = parseVersion(process.versions.node);
  if (
    !nodeVersion ||
    nodeVersion[0] !== TARGET_NODE_MAJOR ||
    !isAtLeastVersion(nodeVersion, TARGET_NODE_VERSION)
  ) {
    throw new Error(
      `Server bundles require Node.js ${TARGET_NODE_VERSION.join('.')} or newer within the ${TARGET_NODE_MAJOR}.x line; received ${process.versions.node}.`,
    );
  }

  const glibcVersion = process.report?.getReport?.().header?.glibcVersionRuntime;
  const parsedGlibcVersion = parseVersion(glibcVersion);
  if (
    !parsedGlibcVersion ||
    parsedGlibcVersion[0] !== TARGET_GLIBC_VERSION[0] ||
    parsedGlibcVersion[1] !== TARGET_GLIBC_VERSION[1]
  ) {
    throw new Error(
      `Server bundles must be built on glibc ${TARGET_GLIBC_VERSION.slice(0, 2).join('.')} exactly; received ${glibcVersion || 'unknown'}.`,
    );
  }
}

function sourceDateEpoch() {
  const value = process.env.SOURCE_DATE_EPOCH;
  if (value === undefined) return '0';
  if (!/^\d+$/.test(value)) {
    throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer number of seconds.');
  }
  return value;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
      ...options,
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function isElfFile(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const magic = Buffer.alloc(4);
    const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
    return bytesRead === 4 && magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  } finally {
    await handle.close();
  }
}

async function collectElfFiles(directory) {
  const files = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectElfFiles(entryPath));
    } else if (entry.isFile() && await isElfFile(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}
async function collectGjcNativesElfFiles(stageDir) {
  const packageScope = path.join(stageDir, 'node_modules', '@gajae-code');
  const entries = await fs.readdir(packageScope, { withFileTypes: true });
  const elfFiles = [];
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('natives-')) {
      elfFiles.push(...await collectElfFiles(path.join(packageScope, entry.name)));
    }
  }
  return elfFiles;
}

async function auditGlibcRequirements(stageDir) {
  const corePath = path.join(stageDir, 'dist-native', 'gajae-core');
  const bunPath = path.join(stageDir, 'dist-native', 'bun');
  const elfFiles = [];
  for (const moduleName of NATIVE_MODULES) {
    elfFiles.push(...await collectElfFiles(path.join(stageDir, 'node_modules', moduleName)));
  }
  elfFiles.push(...await collectGjcNativesElfFiles(stageDir));
  if (!(await isElfFile(corePath))) {
    throw new Error('dist-native/gajae-core is not a Linux ELF executable.');
  }
  if (!(await isElfFile(bunPath))) {
    throw new Error('dist-native/bun is not a Linux ELF executable.');
  }
  elfFiles.push(corePath, bunPath);
  for (const filePath of elfFiles) {
    const versionInfo = await capture('readelf', ['--version-info', '--wide', filePath]);
    for (const match of versionInfo.matchAll(/\bGLIBC_(\d+)\.(\d+)(?:\.(\d+))?\b/gu)) {
      const required = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
      if (!isAtLeastVersion(TARGET_GLIBC_VERSION, required)) {
        throw new Error(
          `${path.relative(stageDir, filePath)} requires GLIBC_${required.join('.')}, newer than the supported ${TARGET_GLIBC_VERSION.slice(0, 2).join('.')} floor.`,
        );
      }
    }
  }
  console.log(`Audited glibc symbol requirements for ${elfFiles.length} produced native files.`);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
function assertGjcSdkProductionDependency(packageJson) {
  if (packageJson.dependencies?.[GJC_SDK_PACKAGE] !== GJC_SDK_VERSION) {
    throw new Error(`${GJC_SDK_PACKAGE}@${GJC_SDK_VERSION} must be an exact production dependency.`);
  }
}

async function assertInstalledGjcSdkDependencies(stageDir) {
  for (const packageName of [GJC_SDK_PACKAGE, GJC_NATIVES_PACKAGE]) {
    let installedPackage;
    try {
      installedPackage = JSON.parse(await fs.readFile(
        path.join(stageDir, 'node_modules', packageName, 'package.json'),
        'utf8',
      ));
    } catch {
      throw new Error(`Production installation is missing ${packageName}@${GJC_SDK_VERSION}.`);
    }
    if (installedPackage.version !== GJC_SDK_VERSION) {
      throw new Error(`Production installation must resolve ${packageName}@${GJC_SDK_VERSION}.`);
    }
  }
}

async function assertBundledBun(directory) {
  const bunPath = path.join(directory, 'dist-native', 'bun');
  let version;
  try {
    version = (await capture(bunPath, ['--version'])).trim();
  } catch {
    throw new Error(`dist-native/bun must be an executable Bun ${BUN_VERSION} binary.`);
  }
  if (version !== BUN_VERSION) {
    throw new Error(`dist-native/bun must report Bun ${BUN_VERSION}.`);
  }
}

async function validateRequiredInputs(relativePaths) {
  const missing = [];
  for (const relativePath of relativePaths) {
    if (!(await pathExists(path.join(rootDir, relativePath)))) {
      missing.push(relativePath);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Required server bundle inputs are missing: ${missing.join(', ')}`);
  }
}

async function copyRequired(stageDir, relativePath) {
  await fs.cp(
    path.join(rootDir, relativePath),
    path.join(stageDir, relativePath),
    { recursive: true },
  );
}

async function writeInstallPackageJson(stageDir, packageJson) {
  const stagedPackageJson = {
    ...packageJson,
    scripts: {},
  };
  await fs.writeFile(
    path.join(stageDir, 'package.json'),
    `${JSON.stringify(stagedPackageJson, null, 2)}\n`,
    'utf8',
  );
}

async function writeRuntimePackageJson(stageDir, packageJson) {
  const runtimePackageJson = {
    name: 'gajae-app-server',
    version: packageJson.version,
    private: true,
    description: 'Gajae App server runtime',
    type: 'module',
    main: 'dist-server/server/index.js',
    bin: {
      'gajae-app': 'scripts/gajae-app-runtime.mjs',
    },
    engines: {
      node: '>=22.22.2 <23',
    },
    scripts: {
      start: 'node scripts/gajae-app-runtime.mjs start',
    },
    dependencies: packageJson.dependencies,
    license: packageJson.license,
  };
  await fs.writeFile(
    path.join(stageDir, 'package.json'),
    `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
    'utf8',
  );
}


function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function smokeNativeRuntime(stageDir) {
  const smokeSource = `
    import { constants } from 'node:fs';
    import { access, mkdir } from 'node:fs/promises';
    import { createRequire } from 'node:module';
    import { spawnSync, spawn } from 'node:child_process';

    import path from 'node:path';
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    const pty = require('node-pty');
    const { rgPath } = require('@vscode/ripgrep');

    const database = new Database(':memory:');
    const result = database.prepare('SELECT 22 AS value').get();
    database.close();
    if (result.value !== 22) throw new Error('better-sqlite3 query failed.');


    await access(rgPath, constants.X_OK);
    const ripgrep = spawnSync(rgPath, ['--version'], { encoding: 'utf8' });
    if (ripgrep.status !== 0) throw new Error('ripgrep failed to start.');

    const corePath = path.join(process.cwd(), 'dist-native', 'gajae-core');
    await access(corePath, constants.X_OK);
    const core = spawnSync(corePath, ['--version'], { encoding: 'utf8' });
    if (core.status !== 0 || !core.stdout.startsWith('gajae-core ')) {
      throw new Error('gajae-core failed to start.');
    }

    const bunPath = path.join(process.cwd(), 'dist-native', 'bun');
    await access(bunPath, constants.X_OK);
    const bun = spawnSync(bunPath, ['--version'], { encoding: 'utf8' });
    if (bun.status !== 0 || bun.stdout.trim() !== '${BUN_VERSION}') {
      throw new Error('Bun failed to start with the required version.');
    }
    const smokeAgentDir = path.join(process.cwd(), '.gjc-smoke-agent');
    await mkdir(smokeAgentDir, { recursive: true });
    await new Promise((resolve, reject) => {
      const worker = spawn(bunPath, [path.join(process.cwd(), 'dist-server', 'server', 'gjc-bun-worker.js')], {
        env: { ...process.env, GJC_WORKER_AGENT_DIR: smokeAgentDir },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let initialized = false;
      let shutdownResponses = 0;
      const timeout = setTimeout(() => {
        worker.kill();
        reject(new Error('staged Bun worker timed out.'));
      }, 10_000);
      const fail = (error) => {
        clearTimeout(timeout);
        worker.kill();
        reject(error);
      };
      worker.stdout.setEncoding('utf8');
      worker.stderr.setEncoding('utf8');
      worker.stdout.on('data', (chunk) => {
        stdout += chunk;
        const lines = stdout.split('\\n');
        stdout = lines.pop();
        try {
          for (const line of lines) {
            if (!line) continue;
            const frame = JSON.parse(line);
            if (frame.kind === 'response' && frame.id === 'stage-init') {
              if (initialized || frame.payload?.ok !== true) {
                throw new Error('staged Bun worker rejected initialization.');
              }
              initialized = true;
              worker.stdin.write(JSON.stringify({
                protocolVersion: 1,
                kind: 'request',
                id: 'stage-shutdown',
                method: 'worker.shutdown',
                payload: {},
              }) + '\\n');
              worker.stdin.end();
            } else if (frame.kind === 'response' && frame.id === 'stage-shutdown') {
              if (frame.payload?.ok !== true || ++shutdownResponses !== 1) {
                throw new Error('staged Bun worker rejected shutdown.');
              }
            }
          }
        } catch (error) {
          fail(error);
        }
      });
      worker.stderr.on('data', (chunk) => { stderr += chunk; });
      worker.once('error', fail);
      worker.once('close', (code) => {
        clearTimeout(timeout);
        if (code === 0 && initialized && shutdownResponses === 1 && !stderr) resolve();
        else reject(new Error('staged Bun worker exited with code ' + code + ': ' + stderr));
      });
      worker.stdin.write(JSON.stringify({
        protocolVersion: 1,
        kind: 'request',
        id: 'stage-init',
        method: 'worker.initialize',
        payload: {},
      }) + '\\n');
    });

    await new Promise((resolve, reject) => {
      const terminal = pty.spawn(process.execPath, ['-e', 'process.exit(0)'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env,
      });
      const timeout = setTimeout(() => {
        terminal.kill();
        reject(new Error('node-pty child timed out.'));
      }, 5_000);
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        if (exitCode === 0) resolve();
        else reject(new Error(\`node-pty child exited with code \${exitCode}.\`));
      });
    });
  `;
  await run(process.execPath, ['--input-type=module', '--eval', smokeSource], { cwd: stageDir });
}

async function createDeterministicArchive(stageDir, archivePath, epoch) {
  const tarPath = archivePath.slice(0, -3);
  await fs.rm(tarPath, { force: true });
  await fs.rm(archivePath, { force: true });

  await run('tar', [
    '--format=gnu',
    '--sort=name',
    `--mtime=@${epoch}`,
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--mode=ugo+rwX,go-w',
    '-cf',
    tarPath,
    '-C',
    stageDir,
    '.',
  ]);
  await run('gzip', ['--no-name', '--force', tarPath]);
}

assertTargetEnvironment();

const packageJson = JSON.parse(
  await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'),
);
const version = packageJson.version;
assertGjcSdkProductionDependency(packageJson);
await assertBundledBun(rootDir);
const bundleName = `gajae-app-server-${version}-linux-x64-node22.tar.gz`;
const bundleRoot = path.join(rootDir, 'release', 'server');
const stageDir = path.join(bundleRoot, `.stage-${version}`);
const archivePath = path.join(bundleRoot, bundleName);
const checksumPath = `${archivePath}.sha256`;
const buildInputs = [
  'dist',
  'dist-server',
  'dist-native',
  'public',
  'shared',
  'package-lock.json',
  'scripts/fix-node-pty.js',
  'scripts/gajae-app-runtime.mjs',
  'packaging/systemd/gajae-app.service',
  'docs/SELF-HOST.md',
  'docs/INSTALL.md',
  'docker/README.md',
  'docker/gjc/Dockerfile',
  'docker/shared/install-gajae-app.sh',
  'docker/shared/start-gajae-app.sh',
  'LICENSE',
  'NOTICE',
];

await validateRequiredInputs(buildInputs);
await fs.mkdir(bundleRoot, { recursive: true });
await fs.rm(stageDir, { recursive: true, force: true });
await fs.rm(archivePath, { force: true });
await fs.rm(checksumPath, { force: true });
await fs.mkdir(stageDir, { recursive: true });

try {
  for (const relativePath of buildInputs) {
    await copyRequired(stageDir, relativePath);
  }
  await writeInstallPackageJson(stageDir, packageJson);


  console.log('Installing production server dependencies into bundle stage...');
  await run('npm', ['ci', '--omit=dev'], {
    cwd: stageDir,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    },
  });
  await assertInstalledGjcSdkDependencies(stageDir);

  console.log(`Rebuilding ${NATIVE_MODULES.join(', ')} from source for Node.js ${TARGET_NODE_MAJOR}...`);
  await run('npm', ['rebuild', '--omit=dev', '--build-from-source', ...NATIVE_MODULES], {
    cwd: stageDir,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      npm_config_build_from_source: 'true',
    },
  });

  await run(process.execPath, ['scripts/fix-node-pty.js'], { cwd: stageDir });
  await auditGlibcRequirements(stageDir);
  await smokeNativeRuntime(stageDir);

  await fs.rm(path.join(stageDir, 'package-lock.json'), { force: true });
  await fs.rm(path.join(stageDir, 'scripts', 'fix-node-pty.js'), { force: true });
  await fs.chmod(path.join(stageDir, 'scripts', 'gajae-app-runtime.mjs'), 0o755);
  await fs.chmod(path.join(stageDir, 'dist-native', 'bun'), 0o755);
  await writeRuntimePackageJson(stageDir, packageJson);

  await createDeterministicArchive(stageDir, archivePath, sourceDateEpoch());
  const digest = await sha256(archivePath);
  await fs.writeFile(checksumPath, `${digest}  ${bundleName}\n`, 'utf8');
} catch (error) {
  await fs.rm(archivePath, { force: true });
  await fs.rm(checksumPath, { force: true });
  throw error;
} finally {
  await fs.rm(stageDir, { recursive: true, force: true });
}

const size = (await fs.stat(archivePath)).size / 1024 / 1024;
console.log(`Wrote ${path.relative(rootDir, archivePath)} (${size.toFixed(1)} MB)`);
console.log(`Wrote ${path.relative(rootDir, checksumPath)}`);