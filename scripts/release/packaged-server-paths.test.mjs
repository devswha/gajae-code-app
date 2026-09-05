import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ancestorNodeModules } from './out-of-tree.mjs';
import { APPIMAGE_ENV_MARKER, appImageLaunchTarget, createSmokeDataDirectory, packagedTargets, parseSmokeOptions, smokeEnvironment, smokeLocation } from './packaged-server-paths.mjs';
import { stop } from './smoke-packaged-server.mjs';

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gajae-packaged-path-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return fs.realpath(directory);
}

async function fixture(t, { linux = true, appName = 'gajae-app', flattened = false } = {}) {
  const directory = await temporary(t);
  const app = path.join(directory, 'checkout', linux ? 'extracted root' : 'Gajae Code App.app');
  const resources = linux ? path.join(app, 'usr', 'lib', appName) : path.join(app, 'Contents', 'Resources');
  const payload = path.join(resources, flattened ? 'server-payload' : 'resources/server-payload');
  const command = path.join(app, ...(linux ? ['usr', 'bin'] : ['Contents', 'MacOS']), 'gajae-app-server');
  const files = [command, path.join(payload, 'dist-server/server/index.js'), path.join(payload, 'dist-native/bun'), path.join(payload, 'dist-native/gajae-core'), path.join(payload, 'server/gjc-runtime-manifest.json')];
  for (const file of files) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'fixture\n', { mode: 0o755 });
  }
  return { directory, app, payload, command, files };
}

test('smoke CLI accepts either package layout and rejects ambiguous or incomplete arguments', () => {
  assert.deepEqual(parseSmokeOptions(['--linux-root', './root', '--data-survival', '--from-copy', '--project-dir', './project']), {
    app: path.resolve('root'), linux: true, projectDir: path.resolve('project'), dataSurvival: true, fromCopy: true, appImageEnv: false,
  });
  assert.equal(parseSmokeOptions(['--tauri-app', 'Gajae Code App.app']).linux, false);
  assert.equal(parseSmokeOptions(['--linux-root', 'squashfs-root', '--appimage-env']).appImageEnv, true);
  for (const args of [[], ['--linux-root'], ['--linux-root', '--data-survival'], ['--tauri-app', 'a', '--linux-root', 'b'], ['--linux-root', 'a', '--linux-root', 'b'], ['--tauri-app', 'a', '--project-dir'], ['--linux-root', 'a', '--bad'], ['--linux-root', 'a', '--from-copy', '--from-copy'], ['--tauri-app', 'a', '--appimage-env'], ['--linux-root', 'a', '--appimage-env', '--data-survival'], ['--linux-root', 'a', '--appimage-env', '--appimage-env']]) {
    assert.throws(() => parseSmokeOptions(args), /Usage:.*--linux-root/);
  }
});

async function appImageFixture(t) {
  const f = await fixture(t, { appName: "App's $literal directory" });
  const files = {
    'AppRun': `#!/bin/sh
APPDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export APPDIR
export PYTHONHOME="$APPDIR/usr/"
export PYTHONPATH="$APPDIR/usr/share/pyshared/:/fixture/user-python"
export LD_LIBRARY_PATH="$APPDIR/usr/lib/:/fixture/user-lib"
exec "$APPDIR/AppRun.wrapped" "$@"
`,
    'AppRun.wrapped': '#!/bin/sh\nexec "$APPDIR/usr/bin/gajae-app-desktop" "$@"\n',
    'gajae-app-desktop.desktop': '[Desktop Entry]\nType=Application\nExec=gajae-app-desktop %u\n',
    'usr/bin/gajae-app-desktop': '#!/bin/sh\necho original-gui-must-not-run\nexit 99\n',
  };
  for (const [relative, content] of Object.entries(files)) await fs.writeFile(path.join(f.app, relative), content, { mode: 0o755 });
  const nodeFixture = '#!/bin/sh\nprintf "%s\\n" node-fixture "$@" "${APPDIR-}" "${PYTHONHOME-}" "${PYTHONPATH-}" "${LD_LIBRARY_PATH-}" "${SMOKE_USER_VALUE-}"\n';
  await fs.writeFile(f.command, nodeFixture);
  return { ...f, appFiles: files, nodeFixture };
}

test('AppImage mode runs real launcher layers and replaces only the disposable GUI while retaining Node fixture commands', { skip: process.platform !== 'linux' }, async t => {
  const f = await appImageFixture(t);
  const original = await packagedTargets(f.app, { linux: true });
  await assert.rejects(appImageLaunchTarget({ app: f.app }, original), /active disposable smoke copy/);
  const location = await smokeLocation(f.app, { linux: true });
  t.after(location.cleanup);
  const copiedApp = location.app;
  location.app = f.app;
  await assert.rejects(appImageLaunchTarget(location, original), /active disposable smoke copy/);
  location.app = copiedApp;
  const node = await packagedTargets(location.app, { linux: true });
  const target = await appImageLaunchTarget(location, node);
  assert.equal(target.command, node.command);
  assert.deepEqual(target.args, node.args);
  assert.equal(target.launchCommand, path.join(location.app, 'AppRun'));
  assert.deepEqual(target.launchArgs, []);
  const env = { ...smokeEnvironment(target, f.directory, {}), SMOKE_USER_VALUE: 'fixture-user-value' };
  const launched = spawnSync(target.launchCommand, target.launchArgs, { cwd: target.cwd, env, encoding: 'utf8' });
  assert.equal(launched.status, 0, launched.stderr);
  assert.deepEqual(launched.stdout.trim().split('\n'), [
    APPIMAGE_ENV_MARKER, 'node-fixture', ...target.args, location.app, `${location.app}/usr/`,
    `${location.app}/usr/share/pyshared/:/fixture/user-python`, `${location.app}/usr/lib/:/fixture/user-lib`, 'fixture-user-value',
  ]);
  assert.doesNotMatch(launched.stdout, /original-gui-must-not-run/);
  const direct = spawnSync(target.command, ['--eval', 'sqlite-fixture'], { cwd: target.cwd, env, encoding: 'utf8' });
  assert.equal(direct.status, 0, direct.stderr);
  assert.match(direct.stdout, /^node-fixture\n--eval\nsqlite-fixture\n/);
  assert.doesNotMatch(direct.stdout, /AppRun supplied/);
  for (const [relative, content] of Object.entries(f.appFiles)) {
    assert.equal(await fs.readFile(path.join(f.app, relative), 'utf8'), content, `original ${relative}`);
    if (relative !== 'usr/bin/gajae-app-desktop') assert.equal(await fs.readFile(path.join(location.app, relative), 'utf8'), content, `copied ${relative}`);
  }
  assert.equal(await fs.readFile(target.command, 'utf8'), f.nodeFixture);
  assert.equal(await fs.readFile(f.command, 'utf8'), f.nodeFixture);
  await location.cleanup();
  await assert.rejects(appImageLaunchTarget(location, target), /active disposable smoke copy/);
});

test('AppImage mode refuses missing or unsafe launchers before changing the copied GUI', { skip: process.platform !== 'linux' }, async t => {
  for (const [name, mutate, expected] of [
    ['Debian layout', async root => fs.rm(path.join(root, 'AppRun')), /AppRun/],
    ['missing wrapped launcher', async root => fs.rm(path.join(root, 'AppRun.wrapped')), /AppRun.wrapped/],
    ['external AppRun', async root => { await fs.rm(path.join(root, 'AppRun')); await fs.symlink('/bin/sh', path.join(root, 'AppRun')); }, /escapes extracted root/],
    ['wrong desktop command', async root => fs.writeFile(path.join(root, 'gajae-app-desktop.desktop'), '[Desktop Entry]\nExec=other-gui\n'), /must launch gajae-app-desktop/],
    ['multiple desktop entries', async root => fs.writeFile(path.join(root, 'other.desktop'), '[Desktop Entry]\nExec=other\n'), /exactly one root desktop entry/],
  ]) {
    await t.test(name, async t => {
      const f = await appImageFixture(t);
      const location = await smokeLocation(f.app, { linux: true }); t.after(location.cleanup);
      const target = await packagedTargets(location.app, { linux: true });
      await mutate(location.app);
      await assert.rejects(appImageLaunchTarget(location, target), expected);
      assert.equal(await fs.readFile(path.join(location.app, 'usr/bin/gajae-app-desktop'), 'utf8'), f.appFiles['usr/bin/gajae-app-desktop']);
    });
  }
});

test('AppImage wrapper fails closed if AppRun did not actually inject each image-owned search path', { skip: process.platform !== 'linux' }, async t => {
  for (const name of ['PYTHONHOME', 'PYTHONPATH', 'LD_LIBRARY_PATH']) {
    await t.test(name, async t => {
      const f = await appImageFixture(t);
      const location = await smokeLocation(f.app, { linux: true }); t.after(location.cleanup);
      const target = await appImageLaunchTarget(location, await packagedTargets(location.app, { linux: true }));
      const launcher = path.join(location.app, 'AppRun');
      const source = await fs.readFile(launcher, 'utf8');
      await fs.writeFile(launcher, source.replace(new RegExp(`^export ${name}=.*$`, 'm'), `unset ${name}`));
      const result = spawnSync(target.launchCommand, target.launchArgs, { cwd: target.cwd, env: smokeEnvironment(target, f.directory, {}), encoding: 'utf8' });
      assert.equal(result.status, 64, result.stderr);
      assert.match(result.stderr, new RegExp(`AppRun did not set image-owned ${name}`));
      assert.doesNotMatch(result.stdout, /node-fixture/);
    });
  }
});

test('discovers Debian and AppImage resources without assuming Tauri app directory spelling', async t => {
  for (const appName of ['gajae-app', 'gajae-app-desktop', 'Gajae Code App', 'app.gajae.desktop']) {
    for (const flattened of [false, true]) {
      await t.test(`${appName}, flattened=${flattened}`, async t => {
        const f = await fixture(t, { appName, flattened });
        await fs.writeFile(path.join(f.app, 'usr/lib/libexample.so'), 'not an app directory');
        const target = await packagedTargets(f.app, { linux: true });
        assert.equal(target.label, 'Tauri Linux');
        assert.equal(target.command, f.command);
        assert.equal(target.cwd, f.payload);
        assert.deepEqual(target.args, [path.join(f.payload, 'dist-server/server/index.js')]);
        assert.equal(target.bun, path.join(f.payload, 'dist-native/bun'));
      });
    }
  }
});

test('preserves both macOS Tauri resource layouts and sidecar path', async t => {
  for (const flattened of [false, true]) {
    await t.test(`flattened=${flattened}`, async t => {
      const f = await fixture(t, { linux: false, flattened });
      const target = await packagedTargets(f.app);
      assert.equal(target.label, 'Tauri');
      assert.equal(target.command, f.command);
      assert.equal(target.cwd, f.payload);
      const location = await smokeLocation(f.app);
      assert.equal(location.app, f.app, 'an already out-of-tree Mac app is not copied by default');
      await location.cleanup();
      await fs.access(f.app);
    });
  }
});

test('rejects missing, ambiguous and incomplete Linux payloads before execution', async t => {
  const cases = [
    ['missing payload', async f => fs.rm(f.payload, { recursive: true }), /exactly one Tauri server-payload.*found 0/],
    ['ambiguous apps', async f => fs.mkdir(path.join(f.app, 'usr/lib/other/resources/server-payload'), { recursive: true }), /exactly one Tauri server-payload.*found 2/],
    ['ambiguous resource mappings', async f => fs.mkdir(path.join(f.app, 'usr/lib/gajae-app/server-payload'), { recursive: true }), /exactly one Tauri server-payload.*found 2/],
    ['missing sidecar', async f => fs.rm(f.command), /gajae-app-server/],
    ['missing entrypoint', async f => fs.rm(f.files[1]), /index\.js/],
    ['missing bundled Bun', async f => fs.rm(f.files[2]), /dist-native\/bun/],
    ['missing bundled core', async f => fs.rm(f.files[3]), /gajae-core/],
    ['non-executable sidecar', async f => fs.chmod(f.command, 0o644), /EACCES/],
    ['payload credentials', async f => fs.writeFile(path.join(f.payload, '.env'), 'OPENAI_API_KEY=fixture'), /refuses a payload containing \.env/],
  ];
  for (const [name, mutate, expected] of cases) {
    await t.test(name, async t => {
      const f = await fixture(t);
      await mutate(f);
      await assert.rejects(packagedTargets(f.app, { linux: true }), expected);
    });
  }
});

test('resource aliases resolving to the same payload are not ambiguous', async t => {
  const f = await fixture(t);
  await fs.symlink('gajae-app', path.join(f.app, 'usr/lib/alias'));
  assert.equal((await packagedTargets(f.app, { linux: true })).cwd, f.payload);
});

test('rejects payload or sidecar links escaping the extracted root', async t => {
  for (const kind of ['payload', 'dependency', 'sidecar']) {
    await t.test(kind, async t => {
      const f = await fixture(t);
      const outside = path.join(f.directory, 'external');
      await fs.mkdir(outside);
      if (kind === 'payload') {
        await fs.rename(f.payload, path.join(outside, 'server-payload'));
        await fs.symlink(path.join(outside, 'server-payload'), f.payload);
      } else if (kind === 'dependency') {
        await fs.mkdir(path.join(f.payload, 'node_modules'));
        await fs.symlink(outside, path.join(f.payload, 'node_modules/repo-dependency'));
      } else {
        await fs.rename(f.command, path.join(outside, 'node'));
        await fs.symlink(path.join(outside, 'node'), f.command);
      }
      await assert.rejects(packagedTargets(f.app, { linux: true }), /escapes extracted root/);
    });
  }
});

test('Linux copies preserve executable modes and relative symlinks, eliminating repository module fallback', async t => {
  const f = await fixture(t);
  const shadow = path.join(path.dirname(f.app), 'node_modules', 'repository-only-fixture');
  await fs.mkdir(shadow, { recursive: true });
  await fs.writeFile(path.join(shadow, 'index.js'), 'module.exports = true;');
  await fs.mkdir(path.join(f.payload, 'node_modules', 'fixture-tool'), { recursive: true });
  await fs.mkdir(path.join(f.payload, 'node_modules', '.bin'));
  const tool = path.join(f.payload, 'node_modules', 'fixture-tool', 'tool.js');
  await fs.writeFile(tool, '#!/usr/bin/env node\n', { mode: 0o751 });
  const relativeLink = 'node_modules/.bin/tool';
  await fs.symlink('../fixture-tool/tool.js', path.join(f.payload, relativeLink));
  const probe = "require.resolve('repository-only-fixture')";
  assert.equal(spawnSync(process.execPath, ['-e', probe], { cwd: f.payload }).status, 0);
  const location = await smokeLocation(f.app, { linux: true });
  t.after(location.cleanup);
  assert.notEqual(location.app, f.app);
  assert.equal(await ancestorNodeModules(location.app), null);
  const target = await packagedTargets(location.app, { linux: true });
  assert.equal(await fs.readlink(path.join(target.cwd, relativeLink)), '../fixture-tool/tool.js');
  assert.equal((await fs.stat(path.join(target.cwd, relativeLink))).mode & 0o777, 0o751);
  assert.equal((await fs.stat(target.command)).mode & 0o111, 0o111);
  assert.equal(await fs.realpath(path.join(target.cwd, relativeLink)), path.join(target.cwd, 'node_modules/fixture-tool/tool.js'));
  const isolated = spawnSync(process.execPath, ['-e', probe], { cwd: target.cwd, encoding: 'utf8', env: smokeEnvironment(target, f.directory) });
  assert.notEqual(isolated.status, 0);
  assert.match(isolated.stderr, /Cannot find module 'repository-only-fixture'/);
  await location.cleanup();
  await assert.rejects(fs.access(location.app));
  await fs.access(f.app);
});

test('Linux always copies even an already out-of-tree extracted root', async t => {
  const f = await fixture(t);
  const location = await smokeLocation(f.app, { linux: true });
  t.after(location.cleanup);
  assert.notEqual(location.app, f.app);
  assert.equal(await ancestorNodeModules(location.app), null);
});

test('child environment isolates credentials, configs and module/runtime overrides', () => {
  const target = { command: '/package/usr/bin/gajae-app-server', cwd: '/package/usr/lib/app/resources/server-payload' };
  const inherited = {
    LANG: 'C.UTF-8', TERM: 'xterm', PATH: '/host/bin', HOME: '/host/home',
    NODE_PATH: '/checkout/node_modules', NODE_OPTIONS: '--import /checkout/loader.mjs',
    LD_PRELOAD: '/host/lib.so', BUN_OPTIONS: '--preload /host/preload.js',
    OPENAI_API_KEY: 'fixture-key', ANTHROPIC_API_KEY: 'fixture-key', GJC_RUNTIME_API_KEY: 'fixture-key',
    AWS_ACCESS_KEY_ID: 'fixture-key', GOOGLE_APPLICATION_CREDENTIALS: '/host/google.json',
    DATABASE_PATH: '/host/auth.db', GJC_WORKER_AGENT_DIR: '/host/agent', XDG_CONFIG_HOME: '/host/.config',
    GAJAE_ALLOW_DEVELOPMENT_BUN: '1', GIT_DIR: '/host/.git', TMUX_PANE: '%1',
  };
  const env = smokeEnvironment(target, '/smoke-data', inherited);
  assert.equal(env.LANG, 'C.UTF-8');
  assert.equal(env.TERM, 'xterm');
  assert.equal(env.HOME, '/smoke-data');
  assert.equal(env.DATABASE_PATH, '/smoke-data/auth.db');
  assert.equal(env.GJC_WORKER_AGENT_DIR, '/smoke-data/agent');
  assert.equal(env.XDG_CONFIG_HOME, '/smoke-data/.config');
  assert.equal(env.GAJAE_ALLOW_DEVELOPMENT_BUN, '0');
  assert.equal(env.PATH.split(path.delimiter)[0], '/smoke-data/bin');
  for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'BUN_OPTIONS', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GJC_RUNTIME_API_KEY', 'AWS_ACCESS_KEY_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'GIT_DIR', 'TMUX_PANE']) assert.equal(env[key], undefined, key);
  assert.equal(inherited.HOME, '/host/home');
});

test('packaged shutdown requires a graceful exit and reaps a hung child', async t => {
  for (const [name, handler, expected] of [
    ['graceful', 'process.exit(0)', null],
    ['failure exit', 'process.exit(7)', /shutdown failed \(code=7/],
    ['unhandled signal', null, /signal=SIGTERM/],
    ['hung child', '', /did not exit after SIGTERM/],
  ]) {
    await t.test(name, async t => {
      const child = spawn(process.execPath, ['-e', `${handler === null ? '' : `process.on('SIGTERM', () => { ${handler} });`} setInterval(() => {}, 1000); process.stdout.write('ready');`], {
        env: {}, stdio: ['ignore', 'pipe', 'ignore'],
      });
      t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
      await once(child.stdout, 'data');
      const instance = { child, output: { value: 'fixture diagnostic' } };
      if (expected) await assert.rejects(stop(instance, { timeoutMs: 200 }), expected);
      else await stop(instance, { timeoutMs: 2_000 });
      assert.ok(child.exitCode !== null || child.signalCode !== null, 'child is reaped before returning');
      if (name === 'hung child') assert.equal(child.signalCode, 'SIGKILL');
      await stop(instance);
    });
  }
  await t.test('an already exited child cannot pass shutdown', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(9)'], { env: {}, stdio: 'ignore' });
    await once(child, 'close');
    await assert.rejects(stop({ child, output: { value: '' } }), /exited before shutdown \(9\)/);
  });
});

test('default fixture directory passes the production workspace gate while /tmp remains forbidden', async t => {
  const dataDirectory = await createSmokeDataDirectory();
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  assert.equal(path.dirname(dataDirectory), os.homedir());
  assert.equal((await fs.stat(dataDirectory)).mode & 0o077, 0, 'the isolated HOME is private');
  const projectDir = path.join(dataDirectory, 'project');
  await fs.mkdir(projectDir);
  const source = `
    import { validateWorkspacePath } from ${JSON.stringify(new URL('../../server/shared/utils.ts', import.meta.url).href)};
    const allowed = await validateWorkspacePath(process.env.WORKSPACES_ROOT);
    const forbidden = await validateWorkspacePath('/tmp/gajae-packaged-project');
    console.log(JSON.stringify({ allowed, forbidden }));
  `;
  const target = { command: process.execPath, cwd: dataDirectory };
  const checked = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    env: {
      ...smokeEnvironment(target, dataDirectory),
      WORKSPACES_ROOT: projectDir,
      TSX_TSCONFIG_PATH: 'server/tsconfig.json',
    },
    encoding: 'utf8',
  });
  assert.equal(checked.status, 0, checked.stderr);
  const { allowed, forbidden } = JSON.parse(checked.stdout);
  assert.deepEqual(allowed, { valid: true, resolvedPath: await fs.realpath(projectDir) });
  assert.equal(forbidden.valid, false);
  assert.match(forbidden.error, /Cannot create workspace in system directory: \/tmp/);
  await fs.rm(dataDirectory, { recursive: true, force: true });
  await assert.rejects(fs.access(dataDirectory), 'the whole fixture, including its isolated HOME, is disposable');
});
