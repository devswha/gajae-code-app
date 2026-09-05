import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installGjcCliShim } from './gjc-cli-shim.js';

function withTempHome(callback: (homeDir: string) => void): void {
  const homeDir = mkdtempSync(path.join(os.tmpdir(), 'gjc-cli-shim-'));
  try {
    callback(homeDir);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
}

const BUN_PATH = '/runtime/bun';
const BIN_PATH = '/runtime/bin/gjc.js';

function install(homeDir: string, env: NodeJS.ProcessEnv = {}): { shimDir: string } | null {
  return installGjcCliShim({
    env,
    homeDir,
    bunPath: BUN_PATH,
    resolveRuntimeBin: () => BIN_PATH,
  });
}

test('creates an executable gjc shim and prepends it to PATH', () => {
  withTempHome((homeDir) => {
    const env = { PATH: '/existing/bin' };
    const installed = install(homeDir, env);
    assert.ok(installed);
    const shim = readFileSync(path.join(installed.shimDir, 'gjc'), 'utf8');
    assert.match(shim, new RegExp(BUN_PATH));
    assert.match(shim, new RegExp(BIN_PATH));
    assert.match(shim, /"\$@"/);
    assert.equal(statSync(path.join(installed.shimDir, 'gjc')).mode & 0o777, 0o755);
    assert.equal(env.PATH, `${installed.shimDir}${path.delimiter}/existing/bin`);
  });
});

test('does not rewrite an unchanged shim or duplicate its PATH entry', () => {
  withTempHome((homeDir) => {
    const env = { PATH: '/existing/bin' };
    const first = install(homeDir, env);
    assert.ok(first);
    const firstMtime = statSync(path.join(first.shimDir, 'gjc')).mtimeMs;
    const second = install(homeDir, env);
    assert.ok(second);
    assert.equal(statSync(path.join(second.shimDir, 'gjc')).mtimeMs, firstMtime);
    assert.equal(env.PATH?.split(path.delimiter).filter((entry) => entry === first.shimDir).length, 1);
  });
});

test('rewrites a shim whose content drifted', () => {
  withTempHome((homeDir) => {
    const installed = install(homeDir);
    assert.ok(installed);
    const shimPath = path.join(installed.shimDir, 'gjc');
    writeFileSync(shimPath, '#!/bin/sh\nexec "/runtime/bun" "/old/bin/gjc.js" "$@"\n');
    install(homeDir);
    assert.match(readFileSync(shimPath, 'utf8'), new RegExp(BIN_PATH));
  });
});

test('restores executable mode when replacing stale shim content', () => {
  withTempHome((homeDir) => {
    const installed = install(homeDir);
    assert.ok(installed);
    const shimPath = path.join(installed.shimDir, 'gjc');
    writeFileSync(shimPath, '#!/bin/sh\nexit 1\n');
    chmodSync(shimPath, 0o644);

    assert.ok(install(homeDir));
    assert.equal(statSync(shimPath).mode & 0o777, 0o755);
    assert.match(readFileSync(shimPath, 'utf8'), new RegExp(BIN_PATH));
  });
});

test('executes runtime paths with shell metacharacters literally and preserves arguments', { skip: process.platform === 'win32' }, () => {
  withTempHome((homeDir) => {
    const runtimeDir = path.join(homeDir, 'runtime \' "$PATH" $(printf expanded) `printf expanded` \\ space');
    mkdirSync(runtimeDir);
    const bunPath = path.join(runtimeDir, 'bun');
    const binPath = path.join(runtimeDir, 'gjc.cjs');
    symlinkSync(process.execPath, bunPath);
    writeFileSync(binPath, 'process.stdout.write(JSON.stringify(process.argv.slice(1)));\n');
    const installed = installGjcCliShim({ env: {}, homeDir, bunPath, resolveRuntimeBin: () => binPath });
    assert.ok(installed);

    const args = ['arg with spaces', '$PATH', '`printf argument`', "single'quote", ''];
    const result = spawnSync(path.join(installed.shimDir, 'gjc'), args, { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [binPath, ...args]);
  });
});

test('uses the existing case-insensitive PATH key on win32', () => {
  withTempHome((homeDir) => {
    const env: NodeJS.ProcessEnv = { Path: '/existing/bin' };
    const installed = installGjcCliShim({
      env,
      homeDir,
      bunPath: BUN_PATH,
      platform: 'win32',
      resolveRuntimeBin: () => BIN_PATH,
    });
    assert.ok(installed);
    assert.equal(env.Path, `${installed.shimDir}${path.delimiter}/existing/bin`);
    assert.equal(env.PATH, undefined);
  });
});

test('writes a cmd shim on win32', () => {
  withTempHome((homeDir) => {
    const installed = installGjcCliShim({
      homeDir,
      bunPath: BUN_PATH,
      platform: 'win32',
      resolveRuntimeBin: () => BIN_PATH,
    });
    assert.ok(installed);
    assert.equal(
      readFileSync(path.join(installed.shimDir, 'gjc.cmd'), 'utf8'),
      `@echo off\r\n"${BUN_PATH}" "${BIN_PATH}" %*\r\n`,
    );
  });
});

test('returns null without changing PATH when the runtime bin cannot resolve', () => {
  withTempHome((homeDir) => {
    const env = { PATH: '/existing/bin' };
    assert.equal(installGjcCliShim({ env, homeDir, resolveRuntimeBin: () => null }), null);
    assert.equal(env.PATH, '/existing/bin');
  });
});
