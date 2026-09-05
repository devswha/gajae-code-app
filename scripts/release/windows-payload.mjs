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
  // Keep Windows/.NET installation and account metadata needed by OS tools.
  // User homes, module search paths, caches and credentials stay isolated below.
  for (const name of [
    'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'SystemDrive', 'OS',
    'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION', 'NUMBER_OF_PROCESSORS',
    'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432',
    'ProgramData', 'ALLUSERSPROFILE', 'COMPUTERNAME', 'USERNAME', 'USERDOMAIN',
  ]) {
    const key = Object.keys(inherited).find(key => key.toLowerCase() === name.toLowerCase());
    if (key) env[name] = inherited[key];
  }
  const systemRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows';
  const powershellDirectory = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0');
  return {
    ...env,
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    ComSpec: env.ComSpec || path.win32.join(systemRoot, 'System32', 'cmd.exe'),
    SystemDrive: env.SystemDrive || path.win32.parse(systemRoot).root.replace(/\\$/, ''),
    PATHEXT: env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    PATH: [nodeDirectory, path.win32.join(systemRoot, 'System32'), systemRoot, powershellDirectory].join(';'),
    PSModulePath: [
      ...(env.ProgramFiles ? [path.win32.join(env.ProgramFiles, 'WindowsPowerShell', 'Modules')] : []),
      path.win32.join(powershellDirectory, 'Modules'),
    ].join(';'),
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

/** Test Windows PowerShell's actual .NET compiler without a built server payload. */
export async function verifyWindowsSmokeEnvironment(env, cwd, { execute = promisify(execFile) } = {}) {
  // Packaging runs after npm ci, before a compiled server is required. Load the
  // source-only compiler helper through the existing build-time tsx runtime so
  // this preflight exercises exactly the code shipped by the production guard.
  const { tsImport } = await import('tsx/esm/api');
  const { windowsCodeDomCompileScript } = await tsImport(new URL('../../server/gjc-windows-job.ts', import.meta.url).href, import.meta.url);
  const powershell = path.win32.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const source = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::Error.WriteLine('Checking isolated Windows PowerShell/.NET compiler environment.')
try {
    $runtime = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
    $temporary = [System.IO.Path]::GetTempPath()
    $compiler = [System.IO.Path]::Combine($runtime, 'csc.exe')
    $details = [ordered]@{
        powershell = $PSVersionTable.PSVersion.ToString()
        clr = [Environment]::Version.ToString()
        runtime = $runtime
        compiler = $compiler
        compilerExists = [System.IO.File]::Exists($compiler)
        cwd = [Environment]::CurrentDirectory
        temp = $temporary
        tempExists = [System.IO.Directory]::Exists($temporary)
        userProfile = $env:USERPROFILE
        systemRoot = $env:SystemRoot
    }
    [Console]::Out.WriteLine(($details | ConvertTo-Json -Compress))
    if (!$details.compilerExists) { throw 'The Windows .NET Framework csc.exe compiler is missing.' }
    if (!$details.tempExists) { throw 'The isolated .NET temporary directory does not exist.' }
    $probe = [System.IO.Path]::Combine($temporary, ('gajae-' + [Guid]::NewGuid().ToString() + '.tmp'))
    [System.IO.File]::WriteAllText($probe, 'isolated-temp-writable')
    [System.IO.File]::Delete($probe)
    ${windowsCodeDomCompileScript('public static class GajaeSmokeEnvironmentProbe { public static int Value() { return 42; } }', true)}
    [Console]::Out.WriteLine(('{"compiled":' + [GajaeSmokeEnvironmentProbe]::Value() + '}'))
} catch {
    [Console]::Error.WriteLine($_.Exception.ToString())
    exit 1
}
`.trim();
  try {
    const encoded = Buffer.from(source, 'utf16le').toString('base64');
    const { stdout } = await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      cwd, env, windowsHide: true, shell: false, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024,
    });
    const records = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    if (records.at(-1)?.compiled !== 42) throw new Error('Add-Type did not return its compiled result.');
    return { ...records[0], ...records.find(record => record.compilerTemp) };
  } catch (error) {
    // Do not echo execFile's command field (production guards use huge encoded
    // commands). The bounded stdout/stderr contain the useful native evidence.
    throw new Error(`Isolated Windows Add-Type preflight failed (exit ${error.code ?? 'unknown'}${error.killed ? ', timed out' : ''}).\n${String(error.stdout ?? '').slice(-16_384)}\n${String(error.stderr ?? (error.cmd ? '' : error.message)).slice(-16_384)}`);
  }
}
