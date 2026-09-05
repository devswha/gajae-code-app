import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, cp, lstat, mkdtemp, readdir, readFile, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ancestorNodeModules, assertOutOfTree } from './out-of-tree.mjs';

const USAGE = 'Usage: node scripts/release/smoke-packaged-server.mjs (--tauri-app <path> | --linux-root <dir>) [--project-dir <path>] [--data-survival | --appimage-env] [--from-copy]';
const smokeCopies = new WeakMap();
export const APPIMAGE_ENV_MARKER = 'gajae-smoke: AppRun supplied image-owned PYTHONHOME, PYTHONPATH and LD_LIBRARY_PATH';

export function parseSmokeOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (Object.hasOwn(options, name)) throw new Error(USAGE);
    if (['--data-survival', '--from-copy', '--appimage-env'].includes(name)) options[name] = true;
    else if (['--tauri-app', '--linux-root', '--project-dir'].includes(name)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      options[name] = value;
    } else throw new Error(USAGE);
  }
  if (Boolean(options['--tauri-app']) === Boolean(options['--linux-root'])) throw new Error(USAGE);
  if (options['--appimage-env'] && (!options['--linux-root'] || options['--data-survival'])) throw new Error(USAGE);
  return {
    app: path.resolve(options['--tauri-app'] || options['--linux-root']),
    linux: Boolean(options['--linux-root']),
    projectDir: options['--project-dir'] ? path.resolve(options['--project-dir']) : null,
    dataSurvival: Boolean(options['--data-survival']),
    fromCopy: Boolean(options['--from-copy']),
    appImageEnv: Boolean(options['--appimage-env']),
  };
}

export async function smokeLocation(app, { linux = false, fromCopy = false } = {}) {
  // Canonicalize the root as well: a symlink outside the checkout can point in.
  app = await realpath(app);
  const shadow = await ancestorNodeModules(app);
  if (!linux && !shadow && !fromCopy) return { app, cleanup: async () => {} };
  const stagingDir = await mkdtemp(path.join(os.tmpdir(), 'gajae-packaged-smoke-app-'));
  try {
    await assertOutOfTree(stagingDir, 'packaged app copy');
    const copy = path.join(stagingDir, path.basename(app));
    console.log(`Copying ${app} to ${copy} for an out-of-tree packaged smoke${shadow ? ` (ancestor: ${shadow})` : ''}.`);
    if (linux) {
      // Without verbatimSymlinks, cp rewrites relative links back to the source
      // tree, allowing dependencies missing from the package to resolve there.
      await cp(app, copy, { recursive: true, dereference: false, verbatimSymlinks: true });
    } else {
      await new Promise((resolve, reject) => {
        // Preserve macOS bundle permissions, symlinks and extended attributes.
        const child = spawn('ditto', [app, copy], { stdio: ['ignore', 'inherit', 'inherit'] });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error(`ditto exited with code ${code}`)));
      });
    }
    const copiedApp = await realpath(copy);
    const location = { app: copiedApp, cleanup: async () => {
      smokeCopies.delete(location);
      await rm(stagingDir, { recursive: true, force: true });
    } };
    smokeCopies.set(location, copiedApp);
    return location;
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

export async function appImageLaunchTarget(location, target) {
  if (process.platform !== 'linux') throw new Error('--appimage-env requires a Linux host.');
  // Accept only a disposable copy created here, never a caller-supplied root.
  if (!smokeCopies.has(location) || location.app !== smokeCopies.get(location)) throw new Error('AppImage launcher replacement requires an active disposable smoke copy.');
  const app = await realpath(location.app);
  if (app !== smokeCopies.get(location)) throw new Error('AppImage disposable smoke copy must not resolve to another root.');
  const launchCommand = path.join(app, 'AppRun');
  const gui = path.join(app, 'usr', 'bin', 'gajae-app-desktop');
  for (const file of [launchCommand, path.join(app, 'AppRun.wrapped'), gui, target.command, ...target.args]) {
    await checkContained(app, file);
    if (!(await stat(file)).isFile()) throw new Error(`AppImage smoke requires a regular file: ${file}`);
  }
  for (const executable of [launchCommand, path.join(app, 'AppRun.wrapped'), gui]) await access(executable, constants.X_OK);
  if (!(await lstat(gui)).isFile() || await realpath(gui) === await realpath(target.command)) {
    throw new Error('AppImage GUI launcher must be a separate regular file, not a symlink or the Node sidecar.');
  }
  const desktopFiles = (await readdir(app)).filter(name => name.endsWith('.desktop'));
  if (desktopFiles.length !== 1) throw new Error('AppImage smoke requires exactly one root desktop entry.');
  const desktop = await checkContained(app, path.join(app, desktopFiles[0]));
  if (!/^Exec=gajae-app-desktop(?:[ \t].*)?\r?$/m.test(await readFile(desktop, 'utf8'))) {
    throw new Error('AppImage desktop entry must launch gajae-app-desktop.');
  }
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const wrapper = `#!/bin/sh
set -eu
[ "\${APPDIR-}" = ${quote(app)} ] || { echo 'AppImage smoke did not receive the copied APPDIR' >&2; exit 64; }
case "\${PYTHONHOME-}" in "$APPDIR"/*) ;; *) echo 'AppRun did not set image-owned PYTHONHOME' >&2; exit 64 ;; esac
case ":\${PYTHONPATH-}:" in *":$APPDIR/"*) ;; *) echo 'AppRun did not set image-owned PYTHONPATH' >&2; exit 64 ;; esac
case ":\${LD_LIBRARY_PATH-}:" in *":$APPDIR/"*) ;; *) echo 'AppRun did not set image-owned LD_LIBRARY_PATH' >&2; exit 64 ;; esac
printf '%s\\n' ${quote(APPIMAGE_ENV_MARKER)}
exec ${[target.command, ...target.args].map(quote).join(' ')} "$@"
`;
  // Unlink first so even a hardlinked executable cannot change another file.
  await rm(gui);
  await writeFile(gui, wrapper, { flag: 'wx', mode: 0o755 });
  return { ...target, label: 'Tauri Linux AppImage AppRun', launchCommand, launchArgs: [], appImageEnv: true };
}

export function createSmokeDataDirectory() {
  // The project-creation API rejects /tmp even inside WORKSPACES_ROOT. Keep
  // the isolated HOME and its fixture project together in a private, disposable
  // directory under the user's home; never register or modify their checkout.
  return mkdtemp(path.join(os.homedir(), '.gajae-packaged-smoke-'));
}

async function isDirectory(candidate) {
  try { return (await stat(candidate)).isDirectory(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function checkContained(root, candidate) {
  const resolved = await realpath(candidate);
  if (!contained(root, resolved)) throw new Error(`Packaged path escapes extracted root: ${candidate} -> ${resolved}`);
  return resolved;
}

async function checkPayloadLinks(root, directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const destination = path.resolve(directory, await readlink(candidate));
      if (!contained(root, destination)) throw new Error(`Packaged symlink escapes extracted root: ${candidate} -> ${destination}`);
      await checkContained(root, candidate);
    } else if (entry.isDirectory()) await checkPayloadLinks(root, candidate);
  }
}

export async function packagedTargets(app, { linux = false } = {}) {
  app = await realpath(app);
  let resourceDirectories;
  if (linux) {
    const lib = path.join(app, 'usr', 'lib');
    if (!await isDirectory(lib)) throw new Error(`Tauri Linux resource directory not found: ${lib}`);
    resourceDirectories = (await readdir(lib)).sort().map(name => path.join(lib, name));
    const directories = [];
    for (const candidate of resourceDirectories) if (await isDirectory(candidate)) directories.push(candidate);
    resourceDirectories = directories;
  } else resourceDirectories = [path.join(app, 'Contents', 'Resources')];
  const payloads = new Set();
  for (const directory of resourceDirectories) {
    for (const relative of ['resources/server-payload', 'server-payload']) {
      const candidate = path.join(directory, relative);
      if (await isDirectory(candidate)) payloads.add(await checkContained(app, candidate));
    }
  }
  if (payloads.size !== 1) {
    throw new Error(`Expected exactly one Tauri server-payload under ${linux ? path.join(app, 'usr', 'lib', '<app>') : path.join(app, 'Contents', 'Resources')} (resources/server-payload or server-payload); found ${payloads.size}${payloads.size ? `: ${[...payloads].join(', ')}` : ''}`);
  }
  const [payload] = payloads;
  const command = path.join(app, ...(linux ? ['usr', 'bin'] : ['Contents', 'MacOS']), 'gajae-app-server');
  const entrypoint = path.join(payload, 'dist-server', 'server', 'index.js');
  const bun = path.join(payload, 'dist-native', 'bun');
  const core = path.join(payload, 'dist-native', 'gajae-core');
  for (const file of [command, entrypoint, bun, core, path.join(payload, 'server', 'gjc-runtime-manifest.json')]) {
    await checkContained(app, file);
    if (!(await stat(file)).isFile()) throw new Error(`Packaged file is missing or not a regular file: ${file}`);
  }
  for (const executable of [command, bun, core]) await access(executable, constants.X_OK);
  await checkPayloadLinks(app, payload);
  // load-env.js loads this automatically, including credentials and paths.
  try {
    await lstat(path.join(payload, '.env'));
    throw new Error('Packaged smoke refuses a payload containing .env; it could load live credentials.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { label: linux ? 'Tauri Linux' : 'Tauri', cwd: payload, command, bun, args: [entrypoint] };
}

export function smokeEnvironment(target, dataDirectory, inherited = process.env) {
  // Allow only terminal/locale settings. In particular no provider credentials,
  // NODE_PATH/OPTIONS, loader overrides, terminal identities or user config roots.
  const locale = Object.fromEntries(['LANG', 'LC_ALL', 'LC_CTYPE', 'TERM'].filter(name => inherited[name]).map(name => [name, inherited[name]]));
  return {
    ...locale,
    PATH: [path.join(dataDirectory, 'bin'), path.dirname(target.command), path.join(target.cwd, 'dist-native'), '/usr/bin', '/bin'].join(path.delimiter),
    HOME: dataDirectory,
    XDG_CONFIG_HOME: path.join(dataDirectory, '.config'),
    XDG_DATA_HOME: path.join(dataDirectory, '.local', 'share'),
    XDG_CACHE_HOME: path.join(dataDirectory, '.cache'),
    XDG_STATE_HOME: path.join(dataDirectory, '.local', 'state'),
    TMPDIR: path.join(dataDirectory, 'tmp'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    GAJAE_ALLOW_DEVELOPMENT_BUN: '0', GJC_NO_TITLE: '1',
    GJC_WORKER_AGENT_DIR: path.join(dataDirectory, 'agent'),
    DATABASE_PATH: path.join(dataDirectory, 'auth.db'),
    NODE_ENV: 'production',
  };
}
