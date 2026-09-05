import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { sanitizeAppImageEnvironment } from './appimage-environment.js';

test('AppImage server removes only bundle-owned tool paths and preserves user configuration', () => {
  const env = {
    APPDIR: '/tmp/Gajae.AppDir/', GJC_DESKTOP: '1', HOME: '/home/example', API_KEY: 'fixture-key',
    PYTHONHOME: '/tmp/Gajae.AppDir/usr/',
    PYTHONPATH: '/tmp/Gajae.AppDir/usr/share/pyshared/:/custom/python',
    LD_LIBRARY_PATH: '/tmp/Gajae.AppDir//usr/lib/:/custom/lib:/usr/lib:',
    LD_PRELOAD: '/tmp/Gajae.AppDir/lib/a.so /custom/b.so',
    GTK_PATH: '/tmp/Gajae.AppDir/usr/gtk:/usr/lib/gtk',
    GTK_IM_MODULE_FILE: '/tmp/Gajae.AppDir//usr/gtk/immodules.cache',
    GIO_EXTRA_MODULES: '/tmp/Gajae.AppDir/usr/lib/gio/modules',
    XDG_DATA_DIRS: '/tmp/Gajae.AppDir/usr/share:/usr/local/share:/usr/share:',
    PATH: '/tmp/Gajae.AppDir/usr/bin:/home/example/bin:/usr/bin:/bin',
  };
  sanitizeAppImageEnvironment(env, 'linux');
  assert.equal(env.PYTHONHOME, undefined);
  assert.equal(env.PYTHONPATH, '/custom/python');
  assert.equal(env.LD_LIBRARY_PATH, '/custom/lib:/usr/lib');
  assert.equal(env.LD_PRELOAD, '/custom/b.so');
  assert.equal(env.GTK_PATH, '/usr/lib/gtk');
  assert.equal(env.GTK_IM_MODULE_FILE, undefined);
  assert.equal(env.GIO_EXTRA_MODULES, undefined);
  assert.equal(env.XDG_DATA_DIRS, '/usr/local/share:/usr/share');
  assert.equal(env.PATH, '/home/example/bin:/usr/bin:/bin');
  assert.equal(env.HOME, '/home/example');
  assert.equal(env.API_KEY, 'fixture-key');
});

test('non-AppImage launches and unrelated paths keep their environment', () => {
  for (const env of [
    { APPDIR: '/bundle', PYTHONHOME: '/bundle/usr' },
    { APPDIR: '/', GJC_DESKTOP: '1', PYTHONHOME: '/usr' },
    { APPDIR: 'relative', GJC_DESKTOP: '1', PYTHONHOME: '/usr' },
    { GJC_DESKTOP: '1', PYTHONHOME: '/custom/python' },
    { APPDIR: '/bundle', GJC_DESKTOP: '1', PYTHONHOME: '/bundle-other/python' },
  ]) {
    const before = { ...env };
    sanitizeAppImageEnvironment(env, 'linux');
    assert.deepEqual(env, before);
  }
  const mac = { APPDIR: '/bundle', GJC_DESKTOP: '1', PYTHONHOME: '/bundle/usr' };
  sanitizeAppImageEnvironment(mac, 'darwin');
  assert.equal(mac.PYTHONHOME, '/bundle/usr');
});

test('host Python works after the AppImage server removes AppRun Python overrides', { skip: process.platform !== 'linux' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gajae-appimage-python-'));
  try {
    const env = { PATH: '/usr/bin:/bin', HOME: directory, APPDIR: directory, GJC_DESKTOP: '1',
      PYTHONHOME: `${directory}/usr/`, PYTHONPATH: `${directory}/usr/share/pyshared/` };
    const broken = spawnSync('/usr/bin/python3', ['-c', 'print("python ready")'], { env, encoding: 'utf8' });
    assert.notEqual(broken.status, 0);
    assert.match(broken.stderr, /encodings|Python path configuration/);
    sanitizeAppImageEnvironment(env);
    const working = spawnSync('/usr/bin/python3', ['-c', 'print("python ready")'], { env, encoding: 'utf8' });
    assert.equal(working.status, 0, working.stderr);
    assert.equal(working.stdout.trim(), 'python ready');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
